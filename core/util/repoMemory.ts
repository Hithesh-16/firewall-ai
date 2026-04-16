/**
 * Repo Memory Engine
 *
 * Generates and caches a context summary from past conversations for a given repository.
 * Injected into new sessions so the LLM "remembers" past architecture decisions,
 * patterns, bugs fixed, and file structure — without the user re-explaining.
 *
 * SOLID:
 * - SRP: Only generates/caches/retrieves repo summaries. No scanning, no UI.
 * - OCP: Summary prompt can be extended without changing retrieval logic.
 * - DIP: Depends on HistoryManager interface, not file system directly.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { BaseSessionMetadata, Session } from "..";
import { countTokens } from "../llm/countTokens";
import { HistoryManager } from "./history";
import { getAiFirewallGlobalPath } from "./paths";

// ── Types ──────────────────────────────────────────────────────────────────

export interface RepoSummary {
  workspaceDirectory: string;
  summary: string;
  sessionCount: number;
  generatedAt: number;
  /** Token count of the summary (estimated) */
  tokenEstimate: number;
}

// ── Config ─────────────────────────────────────────────────────────────────

const MAX_SESSIONS_TO_ANALYZE = 10;
const MAX_SUMMARY_TOKENS = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const SUMMARIES_DIR = "repo-summaries";

// ── Cache Paths ────────────────────────────────────────────────────────────

function getSummariesDir(): string {
  const dir = path.join(getAiFirewallGlobalPath(), SUMMARIES_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getRepoHash(workspaceDir: string): string {
  return crypto
    .createHash("sha256")
    .update(workspaceDir)
    .digest("hex")
    .slice(0, 16);
}

function getSummaryPath(workspaceDir: string): string {
  return path.join(getSummariesDir(), `${getRepoHash(workspaceDir)}.json`);
}

// ── Core Functions ─────────────────────────────────────────────────────────

/**
 * Get sessions filtered by workspace directory.
 */
export function listSessionsByRepo(
  historyManager: HistoryManager,
  workspaceDir: string,
  limit: number = MAX_SESSIONS_TO_ANALYZE,
): BaseSessionMetadata[] {
  const all = historyManager.list({});
  return all
    .filter((s) => s.workspaceDirectory === workspaceDir)
    .slice(0, limit);
}

/**
 * Get cached repo summary if still valid.
 * Returns null if cache miss or stale.
 */
export function getCachedSummary(workspaceDir: string): RepoSummary | null {
  const cachePath = getSummaryPath(workspaceDir);
  if (!fs.existsSync(cachePath)) return null;

  try {
    const raw = fs.readFileSync(cachePath, "utf-8");
    const cached = JSON.parse(raw) as RepoSummary;

    // Check TTL
    if (Date.now() - cached.generatedAt > CACHE_TTL_MS) {
      return null; // Stale
    }

    return cached;
  } catch {
    return null;
  }
}

/**
 * Save a repo summary to cache.
 */
export function cacheSummary(summary: RepoSummary): void {
  const cachePath = getSummaryPath(summary.workspaceDirectory);
  fs.writeFileSync(cachePath, JSON.stringify(summary, null, 2));
}

/**
 * Clear cached summary for a repo.
 */
export function clearRepoSummary(workspaceDir: string): boolean {
  const cachePath = getSummaryPath(workspaceDir);
  if (fs.existsSync(cachePath)) {
    fs.unlinkSync(cachePath);
    return true;
  }
  return false;
}

/**
 * Extract key context from past sessions for this repo.
 * Returns a structured text that can be used as LLM summary prompt input
 * or directly as context when no LLM is available.
 *
 * This is a SYNCHRONOUS fallback that doesn't require an LLM call.
 * It extracts titles, tools used, and file paths from past sessions.
 */
export function extractRepoContext(
  historyManager: HistoryManager,
  workspaceDir: string,
): RepoSummary {
  const sessions = listSessionsByRepo(historyManager, workspaceDir);

  if (sessions.length === 0) {
    return {
      workspaceDirectory: workspaceDir,
      summary: "",
      sessionCount: 0,
      generatedAt: Date.now(),
      tokenEstimate: 0,
    };
  }

  // Extract key info from each session without loading full history
  const titles = sessions.map((s) => `- ${s.title}`).join("\n");

  // Load the most recent session to extract deeper context
  let recentContext = "";
  try {
    const recentSession = historyManager.load(sessions[0].sessionId);

    // Extract file paths mentioned in context items
    const filePaths = new Set<string>();
    const toolsUsed = new Set<string>();

    for (const item of recentSession.history) {
      // Collect context item paths
      if (item.contextItems) {
        for (const ctx of item.contextItems) {
          if (ctx.uri?.type === "file" && ctx.description) {
            filePaths.add(ctx.description);
          }
        }
      }
      // Collect tool names used
      if (item.toolCallStates) {
        for (const tc of item.toolCallStates) {
          toolsUsed.add(tc.toolCall.function.name);
        }
      }
      // Check for existing compaction summary
      if (item.conversationSummary) {
        recentContext = item.conversationSummary;
        break; // Use the most recent compaction summary
      }
    }

    if (!recentContext) {
      const parts: string[] = [];
      if (filePaths.size > 0) {
        parts.push(`Key files: ${[...filePaths].slice(0, 10).join(", ")}`);
      }
      if (toolsUsed.size > 0) {
        parts.push(`Tools used: ${[...toolsUsed].join(", ")}`);
      }
      recentContext = parts.join("\n");
    }
  } catch {
    // Failed to load session — use titles only
  }

  const summary = [
    `Repository: ${path.basename(workspaceDir)}`,
    `Past conversations (${sessions.length}):`,
    titles,
    recentContext ? `\nRecent context:\n${recentContext}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Trim to token budget (rough: 4 chars per token)
  const maxChars = MAX_SUMMARY_TOKENS * 4;
  const trimmedSummary =
    summary.length > maxChars
      ? summary.slice(0, maxChars) + "\n... (truncated)"
      : summary;

  const result: RepoSummary = {
    workspaceDirectory: workspaceDir,
    summary: trimmedSummary,
    sessionCount: sessions.length,
    generatedAt: Date.now(),
    // Phase E.E3 (SECURITY_HARDENING_PLAN.md) — replaced
    // `Math.ceil(text.length / 4)` heuristic with the canonical
    // tiktoken-backed counter. Default model "llama2" is fine
    // for a per-summary estimate (counter is content-aware, not
    // model-specific for this purpose).
    tokenEstimate: countTokens(trimmedSummary),
  };

  // Scan summary for secrets/PII before caching (best-effort via @ai-firewall/scanner)
  try {
    const scanner = require("@ai-firewall/scanner");
    const secretResult = scanner.scanSecrets(trimmedSummary);
    const piiResult = scanner.scanPII(trimmedSummary);

    if (secretResult.hasSecrets || piiResult.hasPII) {
      let safeSummary = trimmedSummary;
      for (const s of secretResult.secrets) {
        safeSummary = safeSummary.split(s.value).join(`[REDACTED_${s.type}]`);
      }
      for (const p of piiResult.pii) {
        safeSummary = safeSummary.split(p.value).join(`[REDACTED_${p.type}]`);
      }
      result.summary = safeSummary;
      // Phase E.E3 — same canonical counter as above.
      result.tokenEstimate = countTokens(safeSummary);
    }
  } catch {
    // Scanner not available — store unscanned (acceptable for local-only)
  }

  // Cache it
  cacheSummary(result);

  return result;
}

/**
 * Get repo summary — cache-first, extract on miss.
 * This is the main entry point for the system message injection.
 */
export function getRepoSummary(
  historyManager: HistoryManager,
  workspaceDir: string,
): RepoSummary | null {
  if (!workspaceDir) return null;

  // Check cache first
  const cached = getCachedSummary(workspaceDir);
  if (cached && cached.summary) return cached;

  // Generate fresh summary (synchronous, no LLM needed)
  const summary = extractRepoContext(historyManager, workspaceDir);
  return summary.summary ? summary : null;
}

/**
 * Format repo summary for injection into system message.
 */
export function formatRepoSummaryForSystemMessage(
  summary: RepoSummary,
): string {
  return [
    "\n--- Repository Context (from past conversations) ---",
    summary.summary,
    `--- (${summary.sessionCount} past conversations, updated ${new Date(summary.generatedAt).toLocaleDateString()}) ---\n`,
  ].join("\n");
}
