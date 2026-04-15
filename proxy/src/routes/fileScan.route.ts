/**
 * File Scan Routes
 *
 * Endpoints for scanning individual files and batches through the firewall.
 * Uses content-addressed caching (SHA-256 hash) for performance.
 *
 * Endpoints:
 *   POST /api/scan/file   — Scan a single file
 *   POST /api/scan/batch  — Scan multiple files (max 50)
 *   DELETE /api/scan/cache — Clear scan cache
 *
 * Design: "Scan, don't manage" — proxy reads and scans files, returns results.
 *         No file storage, no upload management, no file modification.
 */

import crypto from "node:crypto";
import path from "node:path";
import picomatch from "picomatch";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, optionalAuth } from "../auth/authMiddleware";
import { loadPolicyConfig, resolveRequestPolicy } from "../config";
import { mergeProjectPolicy } from "../policy/projectPolicy";
import { scanFileContent, isScanError } from "../scanner/fileScanService";
import {
  getCachedScan,
  cacheScanResult,
  invalidateCache,
  getCacheStats,
} from "../scanner/fileScanCache";
import type { FileScanResult, BatchScanResult } from "../types";
import { logRequest } from "../logger/logger";
import { broadcastAll } from "../ws/wsManager";

// ── Schemas ────────────────────────────────────────────────────────────────

const fileScanSchema = z.object({
  filePath: z.string().min(1).max(1024),
  includeRedacted: z.boolean().optional().default(false),
  projectRoot: z.string().max(1024).optional(),
});

const batchScanSchema = z.object({
  filePaths: z.array(z.string().min(1).max(1024)).min(1).max(50),
  includeRedacted: z.boolean().optional().default(false),
  projectRoot: z.string().max(1024).optional(),
});

const cacheDeleteSchema = z.object({
  filePath: z.string().min(1).max(1024).optional(),
});

// ── X-AF-* Header Emission ─────────────────────────────────────────────────

/**
 * Emit X-AF-* scan headers on `/api/scan/file` responses so the existing
 * fetch interceptor (`extractScanHeaders` in @ai-firewall/fetch) picks
 * them up and fires `onScanResult` listeners. That's what surfaces the
 * GUI banner + status bar update for context-provider scans (`@Current
 * File`, `@Open`, etc.) and tool reads (`readFile`, `readFileRange`).
 *
 * Without these headers the banner pipeline never sees file scans —
 * only chat-completion scans — which is why redactions on `@Current
 * File` were silent in the UI.
 */
function setFileScanHeaders(
  reply: any,
  result: FileScanResult,
  filePath: string,
): void {
  reply.header("X-AF-Action", result.action);
  reply.header("X-AF-Risk-Score", String(result.riskScore ?? 0));
  reply.header("X-AF-Secrets-Count", String(result.secretsFound ?? 0));
  reply.header("X-AF-PII-Count", String(result.piiFound ?? 0));
  reply.header("X-AF-Entropy-Count", String(result.entropyFound ?? 0));

  const redactedTypes = [
    ...(result.secrets ?? []).map((s) => s.type),
    ...(result.pii ?? []).map((p) => p.type),
  ];
  if (redactedTypes.length > 0) {
    reply.header("X-AF-Redacted-Types", redactedTypes.join(","));
  }

  // Compact findings header — same shape consumed by parseFindingsHeader
  // in packages/fetch/src/scanHeaders.ts. `f`/`l`/`col` carry the file
  // location so the banner can render `proxy/.env.example:10:16` chips.
  const findings = [
    ...(result.secrets ?? []).map((s) => ({
      t: s.type,
      s: s.severity,
      c: "secret" as const,
      v: s.masked ?? "",
      f: filePath,
      l: s.line,
      col: s.column,
    })),
    ...(result.pii ?? []).map((p) => ({
      t: p.type,
      s: p.severity,
      c: "pii" as const,
      v: p.masked ?? "",
      f: filePath,
      l: p.line,
      col: p.column,
    })),
  ];

  if (findings.length > 0) {
    // Cap at 20 to keep the header under 8KB even with long file paths.
    reply.header("X-AF-Findings", JSON.stringify(findings.slice(0, 20)));
  }
}

/**
 * Emit BLOCK headers when the scan errors out due to a file_scope
 * policy hit. Other error codes (FILE_NOT_FOUND, FILE_TOO_LARGE,
 * FILE_READ_ERROR) are infrastructure failures, not policy decisions,
 * so we leave headers off and let the caller fail-open.
 */
function setScopeBlockHeaders(
  reply: any,
  filePath: string,
  reason: string,
): void {
  reply.header("X-AF-Action", "BLOCK");
  reply.header("X-AF-Risk-Score", "100");
  reply.header("X-AF-Secrets-Count", "0");
  reply.header("X-AF-PII-Count", "0");
  reply.header("X-AF-Entropy-Count", "0");
  reply.header(
    "X-AF-Findings",
    JSON.stringify([
      {
        t: "FILE_SCOPE_BLOCK",
        s: "high",
        c: "secret",
        v: reason,
        f: filePath,
      },
    ]),
  );
}

// ── Route Registration ─────────────────────────────────────────────────────

export async function registerFileScanRoutes(
  app: FastifyInstance,
): Promise<void> {
  /**
   * POST /api/scan/file — Scan a single file
   *
   * Checks cache first (by content hash). On miss, runs full scanner pipeline.
   * Response includes `cached: boolean` to indicate cache hit.
   */
  app.post(
    "/api/scan/file",
    { preHandler: optionalAuth },
    async (request, reply) => {
      const parsed = fileScanSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { filePath, includeRedacted, projectRoot } = parsed.data;
      // Role-aware: when the caller sends a Bearer token (VS Code,
      // CLI), the effective policy includes role-level overrides
      // (e.g. developer's blocked_paths). When no token (core
      // engine's fileScanProxy.ts), falls back to global baseline.
      const policy = resolveRequestPolicy(request.authContext, projectRoot);

      // Scan the file (this also computes the hash)
      const result = scanFileContent(filePath, policy, { includeRedacted });

      if (isScanError(result)) {
        if (result.code === "FILE_BLOCKED") {
          setScopeBlockHeaders(reply, result.filePath, result.error);
        }
        return reply.status(400).send({
          error: result.error,
          code: result.code,
          filePath: result.filePath,
        });
      }

      // Check cache (by path + hash)
      const cached = getCachedScan(filePath, result.fileHash);
      const effective = cached ?? result;

      // Surface scan headers BEFORE returning so the GUI banner +
      // status bar fire for context-provider scans and tool reads.
      setFileScanHeaders(reply, effective, filePath);

      // Log file scan to DB + broadcast (so dashboards show file events)
      logRequest({
        timestamp: Date.now(),
        model: filePath,
        provider: "file-scan",
        originalHash:
          effective.fileHash ||
          crypto.createHash("sha256").update(filePath).digest("hex"),
        sanitizedText: "",
        secretsFound: effective.secretsFound ?? 0,
        piiFound: effective.piiFound ?? 0,
        entropyFound: effective.entropyFound ?? 0,
        filesBlocked: effective.action === "BLOCK" ? 1 : 0,
        riskScore: effective.riskScore ?? 0,
        action: effective.action,
        reasons: effective.reasons ?? [],
        responseTimeMs: effective.scanDurationMs ?? 0,
      });
      broadcastAll({
        type: "scan_result",
        payload: {
          action: effective.action,
          riskScore: effective.riskScore ?? 0,
          secretsFound: effective.secretsFound ?? 0,
          piiFound: effective.piiFound ?? 0,
          entropyFound: effective.entropyFound ?? 0,
          model: filePath,
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      });

      if (cached) {
        return {
          ...cached,
          cached: true,
          // If redacted content was requested but cache doesn't have it, re-scan
          redactedContent: includeRedacted
            ? (cached.redactedContent ?? result.redactedContent)
            : undefined,
        };
      }

      // Cache the result for future lookups
      cacheScanResult(filePath, result.fileHash, result.fileSize, result);

      return result;
    },
  );

  /**
   * GET /api/scan/file/status?path=<absolutePath>&projectRoot=<root>
   *
   * Lightweight check: is this file restricted by file_scope policy?
   * Does NOT read file contents — only checks path against blocklist/allowlist.
   * Used by IDE extensions to grey out files in the explorer view.
   */
  app.get(
    "/api/scan/file/status",
    { preHandler: optionalAuth },
    async (request, reply) => {
      const query = request.query as { path?: string; projectRoot?: string };
      if (!query.path) {
        return reply.status(400).send({ error: "Missing 'path' query param" });
      }

      const policy = resolveRequestPolicy(
        request.authContext,
        query.projectRoot,
      );

      // Resolve the path relative to the supplied project root so that
      // globs like ".env" (root-only) and "**/*.pem" (any depth) both work
      // the way users expect when called from IDEs.
      const root = query.projectRoot
        ? path.resolve(query.projectRoot)
        : process.cwd();
      const absolute = path.resolve(query.path);
      let relativePath = absolute.startsWith(root)
        ? path.relative(root, absolute)
        : query.path;
      relativePath = relativePath.replace(/\\/g, "/");

      const scope = policy.file_scope;
      // Merge file_scope.blocklist + blocked_paths (role policies use
      // the latter). This mirrors the mergeScope() logic in VS Code's
      // fileRestrictionChecker.ts so server and client agree.
      const blocklist = [
        ...(scope?.blocklist ?? []),
        ...(policy.blocked_paths ?? []),
      ];
      const allowlist = scope?.allowlist ?? [];
      const mode = scope?.mode ?? "allow_all";

      const matchesAny = (patterns: string[]): string | null => {
        for (const pat of patterns) {
          if (picomatch(pat, { dot: true })(relativePath)) return pat;
        }
        return null;
      };

      let restricted = false;
      let reason: string | null = null;

      if (mode === "allowlist") {
        const match = matchesAny(allowlist);
        if (!match) {
          restricted = true;
          reason = `Path not in allowlist: ${relativePath}`;
        }
      } else if (mode === "blocklist") {
        const match = matchesAny(blocklist);
        if (match) {
          restricted = true;
          reason = `Matched blocklist pattern: ${match}`;
        }
      }

      return {
        path: query.path,
        relativePath,
        restricted,
        reason,
        mode,
      };
    },
  );

  /**
   * GET /api/scan/file/restricted-patterns?projectRoot=<root>
   *
   * Returns the full list of restricted glob patterns from file_scope
   * policy. Used by dashboards to show "these files/folders are
   * restricted from LLM access".
   */
  app.get(
    "/api/scan/file/restricted-patterns",
    { preHandler: optionalAuth },
    async (request) => {
      const query = request.query as { projectRoot?: string };
      const policy = resolveRequestPolicy(
        request.authContext,
        query.projectRoot,
      );

      return {
        mode: policy.file_scope?.mode ?? "allow_all",
        blocklist: [
          ...(policy.file_scope?.blocklist ?? []),
          ...(policy.blocked_paths ?? []),
        ],
        allowlist: policy.file_scope?.allowlist ?? [],
        maxFileSizeKb: policy.file_scope?.max_file_size_kb ?? null,
      };
    },
  );

  /**
   * POST /api/scan/batch — Scan multiple files
   *
   * Processes each file independently. Returns per-file results + summary.
   * Max 50 files per batch (configurable via schema).
   */
  app.post(
    "/api/scan/batch",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = batchScanSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { filePaths, includeRedacted, projectRoot } = parsed.data;
      const policy = resolveRequestPolicy(request.authContext, projectRoot);

      const results: FileScanResult[] = [];
      let cachedCount = 0;
      let blockedCount = 0;
      let redactedCount = 0;
      let allowedCount = 0;
      let totalRiskScore = 0;

      for (const filePath of filePaths) {
        const scanResult = scanFileContent(filePath, policy, {
          includeRedacted,
        });

        if (isScanError(scanResult)) {
          // Represent errors as BLOCK results in the batch
          results.push({
            filePath: scanResult.filePath,
            fileHash: "",
            fileSize: 0,
            action: "BLOCK",
            riskScore: 100,
            reasons: [scanResult.error],
            secretsFound: 0,
            piiFound: 0,
            entropyFound: 0,
            secrets: [],
            pii: [],
            cached: false,
            scanDurationMs: 0,
          });
          blockedCount++;
          totalRiskScore += 100;
          continue;
        }

        // Check cache
        const cached = getCachedScan(filePath, scanResult.fileHash);
        if (cached) {
          results.push(cached);
          cachedCount++;
        } else {
          cacheScanResult(
            filePath,
            scanResult.fileHash,
            scanResult.fileSize,
            scanResult,
          );
          results.push(scanResult);
        }

        const finalResult = cached ?? scanResult;
        totalRiskScore += finalResult.riskScore;

        switch (finalResult.action) {
          case "BLOCK":
            blockedCount++;
            break;
          case "REDACT":
            redactedCount++;
            break;
          case "ALLOW":
            allowedCount++;
            break;
        }
      }

      const response: BatchScanResult = {
        totalFiles: filePaths.length,
        scanned: filePaths.length - cachedCount,
        cached: cachedCount,
        blocked: blockedCount,
        redacted: redactedCount,
        allowed: allowedCount,
        totalRiskScore,
        results,
      };

      return response;
    },
  );

  /**
   * DELETE /api/scan/cache — Clear scan cache
   *
   * Optional `filePath` query param to clear a specific file's cache.
   * Without it, clears the entire cache.
   */
  app.delete(
    "/api/scan/cache",
    { preHandler: requireAuth },
    async (request, reply) => {
      const query = cacheDeleteSchema.safeParse(request.query);
      const filePath = query.success ? query.data.filePath : undefined;

      const cleared = invalidateCache(filePath);
      const stats = getCacheStats();

      return {
        cleared,
        remaining: stats.totalEntries,
        filePath: filePath ?? null,
      };
    },
  );

  /**
   * GET /api/scan/cache/stats — Cache statistics
   */
  app.get("/api/scan/cache/stats", { preHandler: requireAuth }, async () => {
    return getCacheStats();
  });
}
