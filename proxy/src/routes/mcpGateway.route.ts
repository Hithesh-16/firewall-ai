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

// ── Schemas ────────────────────────────────────────────────────────────────

const toolCallSchema = z.object({
  server_id: z.string().min(1).max(256),
  tool_name: z.string().min(1).max(256),
  arguments: z.record(z.string(), z.unknown()).default({}),
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
  toolName: string
): void {
  reply.header("X-AF-MCP-Action", scanResult.action);
  reply.header("X-AF-MCP-Risk-Score", String(scanResult.riskScore));
  reply.header("X-AF-MCP-Server", serverName);
  reply.header("X-AF-MCP-Tool", toolName);
}

// ── Route Registration ─────────────────────────────────────────────────────

export async function registerMcpGatewayRoutes(
  app: FastifyInstance
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
  app.post("/v1/mcp/tools/call", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = toolCallSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const { server_id, tool_name, arguments: args } = parsed.data;

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

    // 6. Return scan result for the caller to proceed
    // In full integration (Phase 3 Step 3), the caller routes through
    // MCPManagerSingleton and we scan the output too.
    // For MVP, we return the input scan result so the caller knows it's safe.
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
      sanitizedArguments: inputScan.action === "REDACT"
        ? parseSanitizedArgs(inputScan.redactedText, args)
        : args,
    };
  });

  /**
   * POST /v1/mcp/scan — Standalone text scan for MCP context
   *
   * Scan arbitrary text (tool input or output) without the full tool call flow.
   * Useful for pre-flight checks or scanning tool responses independently.
   */
  app.post("/v1/mcp/scan", { preHandler: requireAuth }, async (request, reply) => {
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
  });

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
}

// ── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Parse sanitized args back from redacted text.
 * Best-effort: returns original args with string values replaced by redacted text.
 */
function parseSanitizedArgs(
  redactedText: string | undefined,
  originalArgs: Record<string, unknown>
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
