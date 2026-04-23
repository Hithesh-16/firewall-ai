/**
 * Safely formats an error object into a readable string.
 *
 * Special-cases:
 *   - Anthropic error JSON (rate_limit_error, overloaded_error,
 *     authentication_error, invalid_request_error, api_error, ...)
 *     is unwrapped to a single-line human-readable message so the
 *     chat history doesn't show a raw blob of JSON.
 *   - HTTP-ish error shapes surface `HTTP {status}: {message}`.
 *   - Network errors surface `{code} in {syscall}`.
 */
export function formatError(error: any): string {
  if (error instanceof Error) {
    const anthropic = tryFormatAnthropicJson(error.message);
    if (anthropic) return anthropic;
    return error.message;
  }

  if (typeof error === "string") {
    const anthropic = tryFormatAnthropicJson(error);
    if (anthropic) return anthropic;
    return error;
  }

  if (error && typeof error === "object") {
    if (error.message) {
      const anthropic = tryFormatAnthropicJson(error.message);
      if (anthropic) return anthropic;
      return error.message;
    }
    if (error.error) {
      return formatError(error.error);
    }
    if (error.details) {
      return formatError(error.details);
    }
    if (error.description) {
      return error.description;
    }

    if (error.status && error.error && error.error.message) {
      return `HTTP ${error.status}: ${error.error.message}`;
    }

    if (error.code && error.syscall) {
      return `Network error: ${error.code} in ${error.syscall}`;
    }

    if (error.errors && Array.isArray(error.errors)) {
      return error.errors.join(", ");
    }

    try {
      return JSON.stringify(error);
    } catch {
      return `An error occurred: ${Object.prototype.toString.call(error)}`;
    }
  }

  return String(error);
}

// Anthropic errors are stringfied JSON objects, format them to be more user friendly
export function formatAnthropicError(error: any): string {
  const prefix = "Anthropic:";

  if (error instanceof Error) {
    if (
      error.message.includes("authentication_error") &&
      error.message.includes("invalid x-api-key")
    ) {
      return `${prefix} Invalid API key`;
    }

    return `${prefix} ${error.message}`;
  }

  return `${prefix} ${String(error)}`;
}

/**
 * Detects the Anthropic error-JSON envelope and returns a compact,
 * user-friendly message. Returns null when the string isn't an
 * Anthropic error JSON so the caller can fall back to the raw text.
 *
 * Handles payload shapes:
 *   Plain    → {"type":"error","error":{"type":"...","message":"..."}}
 *   Prefixed → "<anything> {"type":"error", ... }"  (the SDK sometimes
 *              prepends "Anthropic API sent back 429: " before the JSON)
 */
export function tryFormatAnthropicJson(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;

  // Pull out the first balanced {"type":"error" ...} block. We search
  // the needle rather than calling JSON.parse on the whole string so
  // proxy-prepended prefixes like "Anthropic API sent back 429:" don't
  // break parsing.
  const needle = raw.indexOf('{"type":"error"');
  if (needle === -1) return null;
  const jsonSlice = raw.slice(needle);
  let parsed: any;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    // Some payloads have trailing content; try clipping at the last }.
    const lastBrace = jsonSlice.lastIndexOf("}");
    if (lastBrace === -1) return null;
    try {
      parsed = JSON.parse(jsonSlice.slice(0, lastBrace + 1));
    } catch {
      return null;
    }
  }

  const inner = parsed?.error;
  if (!inner || typeof inner !== "object") return null;

  const errType = String(inner.type ?? "error");
  const message = String(inner.message ?? "Anthropic returned an error.");

  // Rate limit — emit an actionable, single-line hint with the
  // limit + model extracted from the message so the user knows what
  // to do next (wait, compact, retry).
  if (errType === "rate_limit_error") {
    const limitMatch = message.match(/rate limit of\s+([\d,]+)\s+(\w+\s+\w+)/i);
    const modelMatch = message.match(/model:\s+([^\s,)]+)/i);
    const limit = limitMatch ? `${limitMatch[1]} ${limitMatch[2]}` : "";
    const model = modelMatch ? modelMatch[1] : "";
    const parts = [
      "⚠️  Anthropic rate limit hit",
      model ? `model: ${model}` : "",
      limit ? `limit: ${limit}` : "",
    ].filter(Boolean);
    return [
      parts.join(" · "),
      "Wait ~60s, run /compact to shrink the conversation, or switch model with /model.",
    ].join("\n");
  }

  if (errType === "overloaded_error") {
    return "⚠️  Anthropic is overloaded. Retry in a moment — your conversation is still intact.";
  }

  if (errType === "authentication_error") {
    return `⚠️  Anthropic auth failed: ${message}. Run /login or update your API key.`;
  }

  if (errType === "permission_error") {
    return `⚠️  Anthropic rejected the request (permission): ${message}`;
  }

  if (errType === "not_found_error") {
    return `⚠️  Anthropic model not found: ${message}. Pick a valid model with /model.`;
  }

  if (errType === "invalid_request_error") {
    // Common cause: prompt too long, too many cache_control breakpoints,
    // unsupported tool shape. Surface the message verbatim — it's
    // usually short and actionable.
    return `⚠️  Invalid request to Anthropic: ${message}`;
  }

  if (errType === "api_error") {
    return `⚠️  Anthropic API error: ${message}`;
  }

  if (errType === "billing_error") {
    return `⚠️  Anthropic billing issue: ${message}`;
  }

  return `⚠️  Anthropic ${errType}: ${message}`;
}
