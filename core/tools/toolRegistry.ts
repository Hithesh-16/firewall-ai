/**
 * Tool Registry
 *
 * Assembles the tool pool from built-in tools + MCP tools.
 * Handles deduplication, sorting (for prompt cache stability), and
 * integration with the permission layer.
 *
 * Modeled after claude-code's tools.ts (assembleToolPool) but using
 * Continue.dev's existing tool implementations.
 */

import type {
  ToolMetadata,
  PermissionContext,
  PermissionDecision,
} from "./toolPermissions";
import { checkToolPermission } from "./toolPermissions";

// ── Tool definition ────────────────────────────────────────────

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly isReadOnly: boolean;
  readonly isDestructive: boolean;
  readonly isConcurrencySafe: boolean;
  readonly isMcp: boolean;
  readonly mcpServerName?: string;
  readonly inputSchema?: Record<string, unknown>;
}

export interface RegisteredTool extends ToolDefinition {
  readonly metadata: ToolMetadata;
}

// ── Registry ───────────────────────────────────────────────────

const registry = new Map<string, RegisteredTool>();

export function registerTool(def: ToolDefinition): void {
  const registered: RegisteredTool = {
    ...def,
    metadata: {
      name: def.name,
      isReadOnly: def.isReadOnly,
      isDestructive: def.isDestructive,
      isConcurrencySafe: def.isConcurrencySafe,
    },
  };
  registry.set(def.name, registered);
}

export function unregisterTool(name: string): boolean {
  return registry.delete(name);
}

export function getTool(name: string): RegisteredTool | null {
  return registry.get(name) ?? null;
}

export function getAllTools(): RegisteredTool[] {
  return Array.from(registry.values());
}

export function getToolCount(): number {
  return registry.size;
}

// ── Pool assembly ──────────────────────────────────────────────

/**
 * Assemble the tool pool: built-in tools first (sorted), then MCP tools (sorted).
 * Deduplicates by name — built-in tools take precedence over MCP tools.
 */
export function assembleToolPool(
  builtInTools: readonly ToolDefinition[],
  mcpTools: readonly ToolDefinition[],
): RegisteredTool[] {
  const seen = new Set<string>();
  const pool: RegisteredTool[] = [];

  // Built-in tools first (sorted for prompt cache stability)
  const sortedBuiltIn = [...builtInTools].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  for (const def of sortedBuiltIn) {
    if (seen.has(def.name)) continue;
    seen.add(def.name);
    const registered: RegisteredTool = {
      ...def,
      metadata: {
        name: def.name,
        isReadOnly: def.isReadOnly,
        isDestructive: def.isDestructive,
        isConcurrencySafe: def.isConcurrencySafe,
      },
    };
    pool.push(registered);
    registry.set(def.name, registered);
  }

  // MCP tools second (sorted)
  const sortedMcp = [...mcpTools].sort((a, b) => a.name.localeCompare(b.name));

  for (const def of sortedMcp) {
    if (seen.has(def.name)) continue;
    seen.add(def.name);
    const registered: RegisteredTool = {
      ...def,
      metadata: {
        name: def.name,
        isReadOnly: def.isReadOnly,
        isDestructive: def.isDestructive,
        isConcurrencySafe: def.isConcurrencySafe,
      },
    };
    pool.push(registered);
    registry.set(def.name, registered);
  }

  return pool;
}

// ── Permission-gated tool access ───────────────────────────────

/**
 * Filter tools to only those the user is permitted to use.
 * Tools with deny rules are completely hidden.
 */
export function getPermittedTools(
  context: PermissionContext,
): RegisteredTool[] {
  const all = getAllTools();
  return all.filter((tool) => {
    const decision = checkToolPermission(tool.metadata, {}, context);
    return decision.behavior !== "deny";
  });
}

/**
 * Check permission for a specific tool call and return the decision.
 */
export function checkToolCallPermission(
  toolName: string,
  input: Record<string, unknown>,
  context: PermissionContext,
): PermissionDecision {
  const tool = getTool(toolName);
  if (!tool) {
    return {
      behavior: "deny",
      reason: `Tool "${toolName}" not found in registry`,
      source: "default",
    };
  }

  return checkToolPermission(tool.metadata, input, context);
}

// ── Tool search (deferred loading pattern) ─────────────────────

/**
 * Search tools by name or keyword.
 * Used when tool count exceeds threshold and schemas are deferred.
 *
 * Supports:
 *   - "select:ToolName" → exact match
 *   - "+required keyword" → require term in name
 *   - "keyword" → fuzzy search on name + description
 */
export function searchTools(query: string, maxResults = 5): RegisteredTool[] {
  const all = getAllTools();

  // Exact match: "select:ToolName"
  if (query.startsWith("select:")) {
    const names = query
      .slice(7)
      .split(",")
      .map((s) => s.trim().toLowerCase());
    return all.filter((t) => names.includes(t.name.toLowerCase()));
  }

  // Parse query terms
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const requiredTerms = terms
    .filter((t) => t.startsWith("+"))
    .map((t) => t.slice(1));
  const optionalTerms = terms.filter((t) => !t.startsWith("+"));

  // Filter by required terms
  let candidates = all;
  if (requiredTerms.length > 0) {
    candidates = candidates.filter((tool) => {
      const text = `${tool.name} ${tool.description}`.toLowerCase();
      return requiredTerms.every((term) => text.includes(term));
    });
  }

  // Score by optional terms
  const scored = candidates.map((tool) => {
    const text = `${tool.name} ${tool.description}`.toLowerCase();
    let score = 0;
    for (const term of optionalTerms) {
      if (tool.name.toLowerCase().includes(term)) score += 3;
      else if (text.includes(term)) score += 1;
    }
    return { tool, score };
  });

  // Sort by score descending, take top N
  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((s) => s.score > 0)
    .slice(0, maxResults)
    .map((s) => s.tool);
}

// ── Reset (for testing) ────────────────────────────────────────

export function clearRegistry(): void {
  registry.clear();
}
