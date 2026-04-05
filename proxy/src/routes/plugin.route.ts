/**
 * Plugin Routes
 *
 * REST API for plugin listing, enable/disable.
 * Used by the GUI Plugin Manager page.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../auth/authMiddleware";
import {
  listPlugins,
  enablePlugin,
  disablePlugin,
  getPlugin,
} from "../plugins/pluginLoader";

// ── Route registration ─────────────────────────────────────────

export async function registerPluginRoutes(
  app: FastifyInstance,
): Promise<void> {
  /**
   * GET /api/plugins
   * List all installed plugins with status.
   */
  app.get("/api/plugins", { preHandler: [requireAuth] }, async () => {
    const plugins = listPlugins();
    return { plugins, total: plugins.length };
  });

  /**
   * POST /api/plugins/:id/enable
   * Enable a plugin by name.
   */
  app.post(
    "/api/plugins/:id/enable",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const success = enablePlugin(id);

      if (!success) {
        return reply.status(404).send({ error: `Plugin "${id}" not found` });
      }

      return { success: true, plugin: id, enabled: true };
    },
  );

  /**
   * POST /api/plugins/:id/disable
   * Disable a plugin by name.
   */
  app.post(
    "/api/plugins/:id/disable",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const success = disablePlugin(id);

      if (!success) {
        return reply.status(404).send({ error: `Plugin "${id}" not found` });
      }

      return { success: true, plugin: id, enabled: false };
    },
  );

  /**
   * GET /api/plugins/:id
   * Get a single plugin's details.
   */
  app.get(
    "/api/plugins/:id",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const plugin = getPlugin(id);

      if (!plugin) {
        return reply.status(404).send({ error: `Plugin "${id}" not found` });
      }

      return {
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        description: plugin.manifest.description,
        enabled: plugin.enabled,
        source: plugin.dirPath,
        loadedAt: plugin.loadedAt,
        errors: plugin.errors,
        commands: plugin.manifest.commands ?? [],
        hooks: plugin.manifest.hooks ?? {},
        skills: plugin.manifest.skills ?? [],
      };
    },
  );
}
