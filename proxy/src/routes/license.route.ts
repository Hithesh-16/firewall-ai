/**
 * License Routes
 *
 * Endpoints for activating, querying, and deactivating license keys.
 *
 * SOLID:
 * - SRP: Route handling only — delegates to licenseVerifier.
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  activateLicense,
  deactivateLicense,
  getLicenseState,
} from "../license/licenseVerifier";

const activateSchema = z.object({
  licenseKey: z.string().min(10).max(2048),
});

export async function registerLicenseRoutes(app: FastifyInstance): Promise<void> {
  /** POST /api/license — activate a license key */
  app.post("/api/license", async (request, reply) => {
    const parsed = activateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid license key format" });
    }

    const state = activateLicense(parsed.data.licenseKey);
    return state;
  });

  /** GET /api/license — current plan and features */
  app.get("/api/license", async () => {
    return getLicenseState();
  });

  /** DELETE /api/license — deactivate (revert to community) */
  app.delete("/api/license", async () => {
    return deactivateLicense();
  });
}
