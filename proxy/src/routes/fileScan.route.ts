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
import { requireAuth } from "../auth/authMiddleware";
import { loadPolicyConfig } from "../config";
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
  app.post("/api/scan/file", async (request, reply) => {
    const parsed = fileScanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const { filePath, includeRedacted, projectRoot } = parsed.data;
    const globalPolicy = loadPolicyConfig();
    const policy = mergeProjectPolicy(globalPolicy, projectRoot);

    // Scan the file (this also computes the hash)
    const result = scanFileContent(filePath, policy, { includeRedacted });

    if (isScanError(result)) {
      return reply.status(400).send({
        error: result.error,
        code: result.code,
        filePath: result.filePath,
      });
    }

    // Check cache (by path + hash)
    const cached = getCachedScan(filePath, result.fileHash);
    const effective = cached ?? result;

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
  });

  /**
   * GET /api/scan/file/status?path=<absolutePath>&projectRoot=<root>
   *
   * Lightweight check: is this file restricted by file_scope policy?
   * Does NOT read file contents — only checks path against blocklist/allowlist.
   * Used by IDE extensions to grey out files in the explorer view.
   */
  app.get("/api/scan/file/status", async (request, reply) => {
    const query = request.query as { path?: string; projectRoot?: string };
    if (!query.path) {
      return reply.status(400).send({ error: "Missing 'path' query param" });
    }

    const globalPolicy = loadPolicyConfig();
    const policy = mergeProjectPolicy(globalPolicy, query.projectRoot);

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
    const blocklist = scope?.blocklist ?? [];
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
  });

  /**
   * GET /api/scan/file/restricted-patterns?projectRoot=<root>
   *
   * Returns the full list of restricted glob patterns from file_scope
   * policy. Used by dashboards to show "these files/folders are
   * restricted from LLM access".
   */
  app.get("/api/scan/file/restricted-patterns", async (request) => {
    const query = request.query as { projectRoot?: string };
    const globalPolicy = loadPolicyConfig();
    const policy = mergeProjectPolicy(globalPolicy, query.projectRoot);

    return {
      mode: policy.file_scope?.mode ?? "allow_all",
      blocklist: policy.file_scope?.blocklist ?? [],
      allowlist: policy.file_scope?.allowlist ?? [],
      maxFileSizeKb: policy.file_scope?.max_file_size_kb ?? null,
    };
  });

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
      const globalPolicy = loadPolicyConfig();
      const policy = mergeProjectPolicy(globalPolicy, projectRoot);

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
