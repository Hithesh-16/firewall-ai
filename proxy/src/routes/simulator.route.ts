import path from "node:path";
import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireCapability } from "../auth/authMiddleware";
import { loadPolicyConfig } from "../config";
import { runLeakSimulation } from "../simulator/leakSimulator";

const simulateSchema = z.object({
  targetDir: z.string().optional(),
  maxFileSizeKb: z.number().optional()
});

export async function registerSimulatorRoute(app: FastifyInstance): Promise<void> {
  app.post("/api/simulate", { preHandler: [requireAuth, requireCapability("scanner:read")] }, async (request, reply) => {
    const parsed = simulateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid payload",
        details: parsed.error.flatten()
      });
    }

    const policy = loadPolicyConfig();
    const targetDir = parsed.data.targetDir
      ? path.resolve(parsed.data.targetDir)
      : process.cwd();
    const maxSize = parsed.data.maxFileSizeKb ?? policy.file_scope.max_file_size_kb;

    const report = runLeakSimulation(targetDir, policy.file_scope, maxSize);

    return report;
  });
}
