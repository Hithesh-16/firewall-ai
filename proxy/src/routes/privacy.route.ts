/**
 * Privacy Routes
 *
 * REST API for privacy settings, data retention, and data deletion.
 * Used by the GUI Privacy Settings page.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth, requireCapability } from "../auth/authMiddleware";
import db from "../db/database";

// ── Zod schemas ────────────────────────────────────────────────

const privacySettingsSchema = z.object({
  telemetryEnabled: z.boolean(),
  retentionDays: z.number().int().min(0).max(365),
  anonymizeLogsEnabled: z.boolean(),
});

// ── Route registration ─────────────────────────────────────────

export async function registerPrivacyRoutes(
  app: FastifyInstance,
): Promise<void> {
  /**
   * GET /api/privacy/settings
   * Read current privacy settings from the settings KV table.
   */
  app.get("/api/privacy/settings", { preHandler: [requireAuth] }, async () => {
    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("privacy_settings") as { value: string } | undefined;

    if (!row) {
      return {
        telemetryEnabled: false,
        retentionDays: 30,
        anonymizeLogsEnabled: true,
      };
    }

    try {
      return JSON.parse(row.value);
    } catch {
      return {
        telemetryEnabled: false,
        retentionDays: 30,
        anonymizeLogsEnabled: true,
      };
    }
  });

  /**
   * POST /api/privacy/settings
   * Save privacy settings.
   */
  app.post(
    "/api/privacy/settings",
    { preHandler: [requireAuth, requireCapability("settings:write")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = privacySettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      db.prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run("privacy_settings", JSON.stringify(parsed.data));

      // Apply retention policy if retention days changed
      if (parsed.data.retentionDays > 0) {
        const cutoff =
          Date.now() - parsed.data.retentionDays * 24 * 60 * 60 * 1000;
        db.prepare("DELETE FROM logs WHERE created_at < ?").run(cutoff);
      }

      return { success: true };
    },
  );

  /**
   * DELETE /api/privacy/data
   * Permanently delete all audit logs, usage data, and scan cache.
   * Requires admin capability.
   */
  app.delete(
    "/api/privacy/data",
    { preHandler: [requireAuth, requireCapability("settings:write")] },
    async () => {
      const tables = ["logs", "usage_logs", "file_scan_cache", "mcp_audit"];
      for (const table of tables) {
        try {
          db.prepare(`DELETE FROM ${table}`).run();
        } catch {
          // Table may not exist in all deployments
        }
      }

      return { success: true, deleted: tables };
    },
  );
}
