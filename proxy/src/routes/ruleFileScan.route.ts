/**
 * Rule File Scan Routes
 *
 * Endpoints for scanning IDE rule files (.cursorrules, .continuerules, CLAUDE.md)
 * that are loaded as trusted system prompts. Defends against ASI04 (Rules File Backdoor).
 *
 * Endpoints:
 *   POST /api/scan/rules           — Scan provided rule file content
 *   POST /api/scan/rules/directory — Scan all known rule files in a directory
 *
 * SOLID:
 * - SRP: Route handling only — delegates to ruleFileScanService
 * - DIP: Depends on scan service interface, not implementation
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authMiddleware";
import {
  scanRuleFile,
  scanRuleFiles,
  scanWorkspaceRuleFiles,
  type RuleFileSource,
} from "../scanner/ruleFileScanService";

// ── Schemas ────────────────────────────────────────────────────────────────

const ruleFileSchema = z.object({
  path: z.string().min(1).max(1024),
  content: z.string().min(1).max(524288), // 512KB max
  source: z.enum([
    ".continuerules",
    ".cursorrules",
    ".windsurfrules",
    "CLAUDE.md",
    "AGENTS.md",
    ".github/copilot-instructions.md",
    ".aifirewall.md",
    "custom",
  ]).default("custom"),
});

const scanRulesSchema = z.object({
  files: z.array(ruleFileSchema).min(1).max(20),
  injection_threshold: z.number().int().min(10).max(100).optional(),
});

const scanDirectorySchema = z.object({
  directory: z.string().min(1).max(1024),
  injection_threshold: z.number().int().min(10).max(100).optional(),
});

// ── Route Registration ─────────────────────────────────────────────────────

export default async function ruleFileScanRoutes(app: FastifyInstance) {
  /**
   * POST /api/scan/rules — Scan provided rule file content
   */
  app.post(
    "/api/scan/rules",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const parseResult = scanRulesSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "Invalid request body",
          details: parseResult.error.issues,
        });
      }

      const { files, injection_threshold } = parseResult.data;

      const requests = files.map((f) => ({
        filePath: f.path,
        content: f.content,
        source: f.source as RuleFileSource,
      }));

      const results = scanRuleFiles(requests, injection_threshold ?? 40);

      const summary = {
        total: results.length,
        blocked: results.filter((r) => r.action === "BLOCK").length,
        warned: results.filter((r) => r.action === "WARN").length,
        allowed: results.filter((r) => r.action === "ALLOW").length,
      };

      return reply.send({
        success: true,
        data: { results, summary },
      });
    }
  );

  /**
   * POST /api/scan/rules/directory — Scan all known rule files in a directory
   */
  app.post(
    "/api/scan/rules/directory",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const parseResult = scanDirectorySchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: "Invalid request body",
          details: parseResult.error.issues,
        });
      }

      const { directory, injection_threshold } = parseResult.data;

      const results = scanWorkspaceRuleFiles(directory, injection_threshold ?? 40);

      const summary = {
        total: results.length,
        blocked: results.filter((r) => r.action === "BLOCK").length,
        warned: results.filter((r) => r.action === "WARN").length,
        allowed: results.filter((r) => r.action === "ALLOW").length,
        scanned_files: results.map((r) => r.filePath),
      };

      return reply.send({
        success: true,
        data: { results, summary },
      });
    }
  );
}
