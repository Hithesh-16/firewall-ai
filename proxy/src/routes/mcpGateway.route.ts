/**
 * MCP Gateway Routes
 *
 * Security gateway for MCP tool calls. Scans all tool inputs and outputs
 * through the firewall scanner pipeline — something no competitor does.
 *
 * Endpoints:
 *   POST /v1/mcp/tools/call  — Scan inputs, forward to MCP server, scan outputs
 *   POST /v1/mcp/tools/list  — List available MCP servers and tools
 *   GET  /v1/mcp/servers      — Server connection statuses
 *   POST /v1/mcp/scan         — Standalone text scan for MCP context
 *   GET  /v1/mcp/audit        — Query MCP audit log
 *   GET  /v1/mcp/audit/stats  — Aggregate MCP audit stats
 *
 * SOLID:
 * - SRP: Route handling only — delegates to mcpScanPipeline and mcpAuditLogger
 * - OCP: New endpoints added without modifying existing ones
 * - DIP: Depends on scan/audit interfaces, not their implementations
 * - LSP: All scan results follow the ScanPipelineResult contract
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authMiddleware";
import { scanMcpContent } from "../mcp/mcpScanPipeline";
import {
  logMcpAudit,
  queryMcpAudit,
  getMcpAuditStats,
} from "../mcp/mcpAuditLogger";
import {
  clearDiscoveredBridge,
  discoverMcpServers,
  syncDiscoveredToCore,
} from "../services/mcpDiscoveryService";
import { evaluateTrust, setTrustDecision } from "../services/mcpTrustService";

// ── Schemas ────────────────────────────────────────────────────────────────

const toolCallSchema = z.object({
  server_id: z.string().min(1).max(256),
  tool_name: z.string().min(1).max(256),
  arguments: z.record(z.string(), z.unknown()).default({}),
  /** Optional tool output to scan (for output scanning — ASI02 defense) */
  output: z.string().optional(),
});

const textScanSchema = z.object({
  text: z.string().min(1),
  direction: z.enum(["input", "output"]).default("input"),
});

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  serverName: z.string().optional(),
  action: z.enum(["ALLOW", "BLOCK", "REDACT"]).optional(),
});

// Phase J.J1 — discovery query/body schemas.
const discoverQuerySchema = z.object({
  projectPath: z.string().min(1, "projectPath is required"),
});

const syncBodySchema = z.object({
  projectPath: z.string().min(1, "projectPath is required"),
  /**
   * If true, skip the trust gate — assumes the caller has the
   * `--trust-project-mcp` env flag set (CI scenario). Without this
   * the gate refuses every source until the user has approved its
   * fingerprint via /v1/mcp/trust.
   */
  trustAll: z.boolean().optional(),
});

// Phase J.J2 — trust decision body.
const trustDecisionSchema = z.object({
  projectPath: z.string().min(1),
  sourcePath: z.string().min(1),
  fingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/, "fingerprint must be SHA-256 hex"),
  decision: z.enum(["trusted", "denied"]),
});

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Serialize tool arguments to text for scanning.
 * Handles nested objects by JSON stringification.
 */
function serializeArguments(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") {
      parts.push(`${key}: ${value}`);
    } else if (value != null) {
      parts.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return parts.join("\n");
}

/**
 * Set X-AF-MCP-* headers on the response.
 */
function setMcpHeaders(
  reply: { header: (name: string, value: string) => void },
  scanResult: { action: string; riskScore: number },
  serverName: string,
  toolName: string,
): void {
  reply.header("X-AF-MCP-Action", scanResult.action);
  reply.header("X-AF-MCP-Risk-Score", String(scanResult.riskScore));
  reply.header("X-AF-MCP-Server", serverName);
  reply.header("X-AF-MCP-Tool", toolName);
}

// ── Route Registration ─────────────────────────────────────────────────────

export async function registerMcpGatewayRoutes(
  app: FastifyInstance,
): Promise<void> {
  /**
   * POST /v1/mcp/tools/call — Scan inputs, forward to MCP, scan outputs
   *
   * This is the core gateway endpoint. In the current MVP, it scans the
   * tool arguments and returns the scan result. The actual MCP forwarding
   * will be wired in when core/tools/callTool.ts routes through this endpoint.
   *
   * Flow:
   *   1. Validate + serialize arguments
   *   2. Scan inputs through pipeline
   *   3. If BLOCK → return 403 with scan details
   *   4. If REDACT → redact sensitive data in args
   *   5. Forward to MCP server (when wired)
   *   6. Scan output response
   *   7. Log both scans to audit table
   *   8. Return with X-AF-MCP-* headers
   */
  app.post(
    "/v1/mcp/tools/call",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = toolCallSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { server_id, tool_name, arguments: args, output } = parsed.data;

      // 1. Serialize arguments to scannable text
      const argsText = serializeArguments(args);

      // 2. Scan inputs
      const inputScan = scanMcpContent(argsText, {
        direction: "input",
        includeRedacted: true,
      });

      // 3. Log input scan
      logMcpAudit(server_id, tool_name, inputScan);

      // 4. Set response headers
      setMcpHeaders(reply, inputScan, server_id, tool_name);

      // 5. If BLOCK → reject
      if (inputScan.action === "BLOCK") {
        return reply.status(403).send({
          error: "MCP tool call blocked by firewall",
          code: "MCP_INPUT_BLOCKED",
          server: server_id,
          tool: tool_name,
          scan: {
            action: inputScan.action,
            riskScore: inputScan.riskScore,
            secretsFound: inputScan.secretsFound,
            piiFound: inputScan.piiFound,
            injectionScore: inputScan.injectionScore,
            reasons: inputScan.reasons,
          },
        });
      }

      // 6. Scan output if provided (ASI02: tool misuse defense)
      let outputScanResult:
        | {
            action: string;
            riskScore: number;
            secretsFound: number;
            piiFound: number;
            reasons: string[];
            scanTimeMs: number;
            redactedText?: string;
          }
        | undefined;

      if (output) {
        const outputScan = scanMcpContent(output, {
          direction: "output",
          includeRedacted: true,
        });
        logMcpAudit(server_id, tool_name, outputScan);

        reply.header("X-AF-MCP-Output-Action", outputScan.action);
        reply.header(
          "X-AF-MCP-Output-Risk-Score",
          String(outputScan.riskScore),
        );

        if (outputScan.action === "BLOCK") {
          return reply.status(403).send({
            error: "MCP tool output blocked by firewall",
            code: "MCP_OUTPUT_BLOCKED",
            server: server_id,
            tool: tool_name,
            scan: {
              action: outputScan.action,
              riskScore: outputScan.riskScore,
              secretsFound: outputScan.secretsFound,
              piiFound: outputScan.piiFound,
              reasons: outputScan.reasons,
            },
          });
        }

        outputScanResult = {
          action: outputScan.action,
          riskScore: outputScan.riskScore,
          secretsFound: outputScan.secretsFound,
          piiFound: outputScan.piiFound,
          reasons: outputScan.reasons,
          scanTimeMs: outputScan.scanTimeMs,
          redactedText:
            outputScan.action === "REDACT"
              ? outputScan.redactedText
              : undefined,
        };
      }

      // 7. Return scan results
      return {
        allowed: true,
        server: server_id,
        tool: tool_name,
        inputScan: {
          action: inputScan.action,
          riskScore: inputScan.riskScore,
          secretsFound: inputScan.secretsFound,
          piiFound: inputScan.piiFound,
          reasons: inputScan.reasons,
          scanTimeMs: inputScan.scanTimeMs,
        },
        // Provide sanitized arguments if redaction was needed
        sanitizedArguments:
          inputScan.action === "REDACT"
            ? parseSanitizedArgs(inputScan.redactedText, args)
            : args,
        // Output scan results (if output was provided).
        // Phase D.D5 (SECURITY_HARDENING_PLAN.md) — when the scan
        // action is REDACT but `redactedText` is `undefined` (e.g.
        // policy says scan-and-warn but don't rewrite), the previous
        // ternary returned undefined, falling back to leaking the raw
        // `output`. Coalesce to a hard "[REDACTED]" sentinel so
        // unredacted content never escapes a REDACT decision.
        ...(outputScanResult
          ? {
              outputScan: outputScanResult,
              sanitizedOutput:
                outputScanResult.action === "REDACT"
                  ? (outputScanResult.redactedText ?? "[REDACTED]")
                  : output,
            }
          : {}),
      };
    },
  );

  /**
   * POST /v1/mcp/scan — Standalone text scan for MCP context
   *
   * Scan arbitrary text (tool input or output) without the full tool call flow.
   * Useful for pre-flight checks or scanning tool responses independently.
   */
  app.post(
    "/v1/mcp/scan",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = textScanSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { text, direction } = parsed.data;
      const result = scanMcpContent(text, { direction, includeRedacted: true });

      return {
        action: result.action,
        riskScore: result.riskScore,
        secretsFound: result.secretsFound,
        piiFound: result.piiFound,
        entropyFound: result.entropyFound,
        injectionScore: result.injectionScore,
        isInjection: result.isInjection,
        reasons: result.reasons,
        redactedText: result.redactedText,
        scanTimeMs: result.scanTimeMs,
      };
    },
  );

  /**
   * GET /v1/mcp/audit — Query MCP audit log
   */
  app.get("/v1/mcp/audit", { preHandler: requireAuth }, async (request) => {
    const parsed = auditQuerySchema.safeParse(request.query);
    const options = parsed.success ? parsed.data : {};
    return { entries: queryMcpAudit(options) };
  });

  /**
   * GET /v1/mcp/audit/stats — Aggregate MCP audit stats
   */
  app.get("/v1/mcp/audit/stats", { preHandler: requireAuth }, async () => {
    return getMcpAuditStats();
  });

  /**
   * GET /v1/mcp/discover — Phase J.J1 (SECURITY_HARDENING_PLAN.md)
   *
   * Pure read: returns the discovered `.mcp.json` sources for the
   * supplied project path plus the merged effective server set
   * (project precedence). Use from the GUI to preview before
   * committing to sync.
   *
   * Query params: ?projectPath=/abs/path/to/project
   */
  app.get(
    "/v1/mcp/discover",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = discoverQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid query",
          details: parsed.error.flatten(),
        });
      }
      const result = discoverMcpServers(parsed.data.projectPath);
      return {
        sources: result.sources.map((s) => ({
          scope: s.scope,
          path: s.path,
          fingerprint: s.fingerprint,
          serverCount: Object.keys(s.servers).length,
          serverNames: Object.keys(s.servers),
        })),
        effective: result.effective,
        effectiveCount: Object.keys(result.effective).length,
      };
    },
  );

  /**
   * POST /v1/mcp/sync — Phase J.J1 + J.J2 (SECURITY_HARDENING_PLAN.md)
   *
   * Writes the merged effective server set into core's MCP config
   * directory so it shows up on the next config refresh.
   *
   * Trust gate (J.J2): each discovered source must pass two layers
   *   1. fingerprint trust (user previously approved this exact hash)
   *   2. manifest scan (denylist + secret scanner against command/args/env)
   * Servers that fail either layer are EXCLUDED from the synced set.
   * The response itemises which sources were blocked and why so the
   * caller can prompt the user.
   *
   * `trustAll: true` bypasses layer 1 (CI / `--trust-project-mcp` env
   * flag scenario). Layer 2 still runs — denylist hits and secret-
   * leaking manifests are NEVER spawned regardless of trustAll.
   */
  app.post(
    "/v1/mcp/sync",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = syncBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid body",
          details: parsed.error.flatten(),
        });
      }
      const { projectPath, trustAll } = parsed.data;

      const result = discoverMcpServers(projectPath);
      if (result.sources.length === 0) {
        clearDiscoveredBridge();
        return { synced: 0, cleared: true, blocked: [], pendingTrust: [] };
      }

      // Apply the trust gate per source. We need to know which
      // server names came from which source so the gate can reject
      // a single bad source without removing legitimate servers
      // declared elsewhere.
      const allowedServers: Record<string, unknown> = {};
      const blocked: Array<{
        sourcePath: string;
        scope: string;
        reason: string;
        details?: readonly string[];
      }> = [];
      const pendingTrust: Array<{
        sourcePath: string;
        scope: string;
        fingerprint: string;
      }> = [];

      for (const source of result.sources) {
        for (const [name, def] of Object.entries(source.servers)) {
          if (trustAll) {
            // Layer 2 still runs.
            const { allowed, reasons } = (
              await import("../services/mcpTrustService")
            ).scanManifest(def);
            if (!allowed) {
              blocked.push({
                sourcePath: source.path,
                scope: source.scope,
                reason: "manifest-blocked",
                details: reasons,
              });
              continue;
            }
            allowedServers[name] = def;
            continue;
          }

          const gate = evaluateTrust({
            projectPath,
            sourcePath: source.path,
            fingerprint: source.fingerprint,
            server: def,
          });
          if (gate.allowed) {
            allowedServers[name] = def;
            continue;
          }
          if (gate.reason.kind === "needs-prompt") {
            pendingTrust.push({
              sourcePath: source.path,
              scope: source.scope,
              fingerprint: source.fingerprint,
            });
          } else if (gate.reason.kind === "fingerprint-changed") {
            blocked.push({
              sourcePath: source.path,
              scope: source.scope,
              reason: `fingerprint-changed (previous decision: ${gate.reason.previousDecision})`,
            });
          } else if (gate.reason.kind === "denied-by-user") {
            blocked.push({
              sourcePath: source.path,
              scope: source.scope,
              reason: "denied-by-user",
            });
          } else if (gate.reason.kind === "manifest-blocked") {
            blocked.push({
              sourcePath: source.path,
              scope: source.scope,
              reason: "manifest-blocked",
              details: gate.reason.reasons,
            });
          }
        }
      }

      if (Object.keys(allowedServers).length === 0) {
        clearDiscoveredBridge();
        return {
          synced: 0,
          cleared: true,
          blocked,
          pendingTrust,
        };
      }
      syncDiscoveredToCore(
        allowedServers as Record<
          string,
          import("../services/mcpDiscoveryService").McpServerDef
        >,
      );
      return {
        synced: Object.keys(allowedServers).length,
        servers: Object.keys(allowedServers),
        blocked,
        pendingTrust,
      };
    },
  );

  /**
   * POST /v1/mcp/trust — Phase J.J2
   *
   * Records a user trust decision (`trusted` | `denied`) for a
   * specific (projectPath, sourcePath, fingerprint) tuple. The next
   * `/v1/mcp/sync` call will let the source through (or refuse it).
   */
  app.post(
    "/v1/mcp/trust",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = trustDecisionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid body",
          details: parsed.error.flatten(),
        });
      }
      const userId =
        (request as unknown as { authContext?: { userId?: number } })
          .authContext?.userId ?? null;
      setTrustDecision({
        projectPath: parsed.data.projectPath,
        sourcePath: parsed.data.sourcePath,
        fingerprint: parsed.data.fingerprint,
        decision: parsed.data.decision,
        userId,
      });
      return { ok: true };
    },
  );
}

// ── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Parse sanitized args back from redacted text.
 * Best-effort: returns original args with string values replaced by redacted text.
 */
function parseSanitizedArgs(
  redactedText: string | undefined,
  originalArgs: Record<string, unknown>,
): Record<string, unknown> {
  if (!redactedText) return originalArgs;

  // Simple approach: for each string arg, find its line in redacted text
  const sanitized: Record<string, unknown> = { ...originalArgs };
  const lines = redactedText.split("\n");

  for (const line of lines) {
    const colonIndex = line.indexOf(": ");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 2);
    if (key in sanitized && typeof sanitized[key] === "string") {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
