import axios, { AxiosError, AxiosResponse } from "axios";
import type { FastifyBaseLogger } from "fastify";

/**
 * Centralized upstream-call helpers for the LLM gateway.
 *
 * The proxy talks to many providers (OpenAI, Anthropic, Gemini, Ollama,
 * generic OpenAI-compatibles). All of them occasionally return transient
 * 5xx / rate-limit responses — Gemini's flagship Pro models in particular
 * 429/503 frequently because their preview capacity is shared and small.
 *
 * Two responsibilities live here:
 *
 *   1. callUpstreamWithRetry — short, bounded exponential backoff so a
 *      transient 503 (UNAVAILABLE) or 429 (RESOURCE_EXHAUSTED) doesn't
 *      bubble up as a hard failure on the first attempt.
 *
 *   2. mapUpstreamError — translate axios/upstream errors into a
 *      structured ProxyUpstreamError with a sensible HTTP status, a
 *      machine-readable code, and a human message. Routes use this to
 *      respond with the right status (503 vs 429 vs 401 vs 502) instead
 *      of always returning a generic 502, and to surface a friendly
 *      message in the chat panel instead of a raw JSON blob.
 *
 * Retry policy (deliberately conservative — we are a request-path proxy,
 * not a background worker):
 *   - max 3 attempts total (1 initial + 2 retries)
 *   - base 500ms, doubling to 1000ms (capped at 5s)
 *   - jitter 0.5x..1x to avoid thundering-herd if many users see the same
 *     503 at once
 *   - honors `Retry-After` response header (clamped to 5s — anything
 *     longer is reported as non-retryable to the user since we can't
 *     hold the chat panel open for 30s)
 */

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  provider: string;
  logger?: FastifyBaseLogger;
}

export interface ProxyUpstreamError {
  status: number;
  code:
    | "UPSTREAM_OVERLOADED"
    | "UPSTREAM_QUOTA_EXCEEDED"
    | "UPSTREAM_AUTH_FAILED"
    | "UPSTREAM_BAD_REQUEST"
    | "UPSTREAM_TIMEOUT"
    | "UPSTREAM_ERROR";
  message: string;
  provider: string;
  retryable: boolean;
  upstreamStatus?: number;
  upstreamMessage?: string;
}

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNREFUSED",
  "EPIPE",
]);

function isRetryableError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  if (error.response && RETRYABLE_HTTP_STATUSES.has(error.response.status)) {
    return true;
  }
  if (error.code && RETRYABLE_NETWORK_CODES.has(error.code)) {
    return true;
  }
  return false;
}

function parseRetryAfter(error: AxiosError, maxDelayMs: number): number | null {
  const header = error.response?.headers?.["retry-after"];
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(seconds * 1000, maxDelayMs);
}

function computeBackoff(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exponential = baseDelayMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, maxDelayMs);
  const jitter = 0.5 + Math.random() * 0.5;
  return Math.floor(capped * jitter);
}

export async function callUpstreamWithRetry<T = unknown>(
  doCall: () => Promise<AxiosResponse<T>>,
  opts: RetryOptions,
): Promise<AxiosResponse<T>> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 5_000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await doCall();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableError(error)) {
        throw error;
      }

      const retryAfterMs = axios.isAxiosError(error)
        ? parseRetryAfter(error, maxDelayMs)
        : null;
      const delayMs =
        retryAfterMs ?? computeBackoff(attempt, baseDelayMs, maxDelayMs);

      const upstreamStatus = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      opts.logger?.warn(
        {
          provider: opts.provider,
          attempt,
          maxAttempts,
          delayMs,
          upstreamStatus,
          retryAfterMs,
        },
        "upstream call failed — retrying",
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // Unreachable — the loop either returns or throws — but TypeScript can't
  // prove it, so we re-throw the last captured error here for completeness.
  throw lastError;
}

function extractUpstreamMessage(payload: unknown): string | undefined {
  if (!payload) return undefined;
  if (typeof payload === "string") {
    return payload.length > 500 ? payload.slice(0, 500) + "…" : payload;
  }
  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    // Google: { error: { message, code, status } }
    const errObj =
      typeof obj.error === "object" && obj.error !== null
        ? (obj.error as Record<string, unknown>)
        : undefined;
    if (errObj && typeof errObj.message === "string") {
      return errObj.message;
    }
    // OpenAI: { error: { message } } — handled above
    // Anthropic: { error: { type, message } } — handled above
    // Ollama: { error: "..." }
    if (typeof obj.error === "string") {
      return obj.error;
    }
    if (typeof obj.message === "string") {
      return obj.message;
    }
  }
  return undefined;
}

export function mapUpstreamError(
  error: unknown,
  provider: string,
): ProxyUpstreamError {
  if (!axios.isAxiosError(error)) {
    return {
      status: 502,
      code: "UPSTREAM_ERROR",
      message: `Unexpected error talking to ${provider}.`,
      provider,
      retryable: false,
    };
  }

  // Network-level failure (no HTTP response at all).
  if (!error.response) {
    if (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED") {
      return {
        status: 504,
        code: "UPSTREAM_TIMEOUT",
        message: `${provider} did not respond in time. Please try again.`,
        provider,
        retryable: true,
      };
    }
    return {
      status: 502,
      code: "UPSTREAM_ERROR",
      message: `Could not reach ${provider}: ${error.code ?? error.message}`,
      provider,
      retryable: true,
    };
  }

  const upstreamStatus = error.response.status;
  const upstreamMessage = extractUpstreamMessage(error.response.data);

  switch (upstreamStatus) {
    case 503:
    case 502:
    case 500:
      return {
        status: 503,
        code: "UPSTREAM_OVERLOADED",
        message: `${provider} is currently overloaded or experiencing high demand. The proxy already retried automatically — please try again in a moment, or switch to a less-saturated model (e.g. gemini-2.5-flash).`,
        provider,
        retryable: true,
        upstreamStatus,
        upstreamMessage,
      };

    case 429:
      return {
        status: 429,
        code: "UPSTREAM_QUOTA_EXCEEDED",
        message: `${provider} rate limit or quota exceeded. ${upstreamMessage ? `Upstream said: ${upstreamMessage}. ` : ""}If this persists, switch model or enable billing on the provider account.`,
        provider,
        retryable: false,
        upstreamStatus,
        upstreamMessage,
      };

    case 401:
    case 403:
      return {
        status: 401,
        code: "UPSTREAM_AUTH_FAILED",
        message: `${provider} rejected the API key. Check the credentials in ~/.ai-firewall/config.yaml or in the Providers page.`,
        provider,
        retryable: false,
        upstreamStatus,
        upstreamMessage,
      };

    case 400:
    case 404:
    case 422:
      return {
        status: 400,
        code: "UPSTREAM_BAD_REQUEST",
        message: `${provider} rejected the request${upstreamMessage ? `: ${upstreamMessage}` : "."}`,
        provider,
        retryable: false,
        upstreamStatus,
        upstreamMessage,
      };

    default:
      return {
        status: 502,
        code: "UPSTREAM_ERROR",
        message: `${provider} returned an unexpected error (HTTP ${upstreamStatus})${upstreamMessage ? `: ${upstreamMessage}` : "."}`,
        provider,
        retryable: false,
        upstreamStatus,
        upstreamMessage,
      };
  }
}
