/**
 * Security Audit Routes
 *
 * Full-repo security audit endpoint. Scans entire project for:
 *   - Hardcoded secrets and credentials
 *   - OWASP Top 10 vulnerability patterns
 *   - Weak cryptographic practices
 *   - Insecure configurations
 *   - Dependency risks
 *   - Attack surface mapping
 *
 * Technology-agnostic — works on any repository.
 *
 * Endpoints:
 *   POST /api/security-audit — Run full security audit
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { runSecurityAudit } from "../scanner/securityAuditScanner";

// ── Schemas ────────────────────────────────────────────────────────────────

const auditRequestSchema = z.object({
  projectPath: z.string().min(1).max(2048),
  maxFiles: z.number().int().min(1).max(50000).optional().default(5000),
  maxFileSize: z
    .number()
    .int()
    .min(1024)
    .max(10 * 1024 * 1024)
    .optional()
    .default(1024 * 1024),
  includeInfoFindings: z.boolean().optional().default(false),
  skipDirs: z.array(z.string()).optional(),
  path: z.string().optional(), // sub-path within project to scope the scan
});

// ── Route Registration ─────────────────────────────────────────────────────

export async function registerSecurityAuditRoutes(
  app: FastifyInstance,
): Promise<void> {
  /**
   * POST /api/security-audit — Run full security audit
   *
   * Scans the entire project directory for security issues.
   * Returns structured findings with severity, category, CWE references,
   * and actionable recommendations.
   */
  app.post("/api/security-audit", async (request, reply) => {
    const parsed = auditRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const {
      projectPath,
      maxFiles,
      maxFileSize,
      includeInfoFindings,
      skipDirs,
      path: subPath,
    } = parsed.data;

    const scanPath = subPath
      ? `${projectPath}/${subPath}`.replace(/\/+/g, "/")
      : projectPath;

    try {
      const result = await runSecurityAudit(scanPath, {
        maxFiles,
        maxFileSize,
        includeInfoFindings,
        skipDirs,
      });

      // Set response headers with summary
      reply.header("X-AF-Audit-Grade", result.summary.grade);
      reply.header("X-AF-Audit-Risk-Score", result.summary.riskScore);
      reply.header("X-AF-Audit-Total-Findings", result.summary.totalFindings);
      reply.header("X-AF-Audit-Files-Scanned", result.filesScanned);

      return reply.status(200).send({
        success: true,
        data: result,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.status(500).send({
        success: false,
        error: `Security audit failed: ${msg}`,
      });
    }
  });
}
