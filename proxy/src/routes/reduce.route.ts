/**
 * Context Reduction Route
 *
 * POST /api/reduce — Reduce content to fit a token budget.
 * Opt-in endpoint — clients call this before sending to LLM.
 * Proxy never auto-reduces; user/client decides when to use it.
 *
 * SOLID:
 * - SRP: Route handling only — delegates to hybridReducer.
 * - DIP: Depends on ReducerResult interface, not reducer internals.
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { reduce } from "../reducer/hybridReducer";

const reduceSchema = z.object({
  /** Content to reduce (file content, code, etc.) */
  content: z.string().min(1),
  /** Keywords to search for (space/comma separated) */
  query: z.string().optional(),
  /** Maximum token budget for output (default: 4000) */
  maxTokens: z.number().int().min(50).max(128000).optional(),
  /** Lines of context around each match (default: 15) */
  windowSize: z.number().int().min(1).max(100).optional(),
  /** Strip comments (default: true) */
  stripComments: z.boolean().optional(),
  /** Strip blank lines (default: true) */
  stripBlanks: z.boolean().optional(),
  /** Strip duplicate lines (default: true) */
  stripDuplicates: z.boolean().optional(),
  /** Language hint for comment detection (default: auto-detect) */
  language: z.string().optional(),
});

export async function registerReduceRoute(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/reduce — Reduce content to fit a token budget.
   *
   * This is an OPT-IN endpoint. The proxy never auto-reduces.
   * Clients (extension, CLI, dashboard) call this when they want to
   * minimize token usage before sending to the LLM.
   *
   * Pipeline: grep (find relevant) -> window (expand context) -> strip (remove noise) -> budget (trim)
   */
  app.post("/api/reduce", async (request, reply) => {
    const parsed = reduceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const result = reduce(parsed.data.content, {
      query: parsed.data.query,
      maxTokens: parsed.data.maxTokens,
      windowSize: parsed.data.windowSize,
      stripComments: parsed.data.stripComments,
      stripBlanks: parsed.data.stripBlanks,
      stripDuplicates: parsed.data.stripDuplicates,
      language: parsed.data.language,
    });

    return {
      reduced: result.content,
      originalTokens: result.originalTokens,
      reducedTokens: result.reducedTokens,
      savingsPercent: result.savingsPercent,
      strategies: result.strategies,
      linesKept: result.linesKept,
      linesRemoved: result.linesRemoved,
    };
  });
}
