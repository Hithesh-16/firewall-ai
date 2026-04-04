import chalk from "chalk";

import { logger } from "../util/logger.js";

export interface MemoryConfig {
  proxyUrl: string;
  token: string;
}

interface MemoryEntry {
  fileName: string;
  type: string;
  title?: string;
}

const TYPE_COLORS: Record<string, (s: string) => string> = {
  user: chalk.cyan,
  feedback: chalk.yellow,
  project: chalk.green,
  reference: chalk.magenta,
};

function colorType(type: string): string {
  return (TYPE_COLORS[type] ?? chalk.dim)(`[${type}]`);
}

/** Memory management: list, index, create. */
export async function memory(
  args: string[],
  config: MemoryConfig,
): Promise<void> {
  const { proxyUrl, token } = config;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  const sub = args[0] ?? "list";

  try {
    if (sub === "list") {
      const res = await fetch(`${proxyUrl}/api/memory`, { headers });
      if (!res.ok) {
        console.log(chalk.red("\u2716") + ` List failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as { data?: MemoryEntry[] };
      const memories = data.data ?? [];
      if (memories.length === 0) {
        console.log(chalk.dim("No memories stored yet."));
        return;
      }
      console.log(chalk.bold(`Memories (${memories.length}):\n`));
      for (const m of memories) {
        console.log(`  ${colorType(m.type)} ${m.title ?? m.fileName}`);
      }
    } else if (sub === "index") {
      const res = await fetch(`${proxyUrl}/api/memory/index`, { headers });
      if (!res.ok) {
        console.log(chalk.red("\u2716") + ` Index failed (${res.status})`);
        return;
      }
      const data = (await res.json()) as { data?: { content?: string } };
      console.log(chalk.bold("MEMORY.md Index:\n"));
      console.log(data.data?.content ?? "Empty index.");
    } else if (sub === "create") {
      const type = args[1] ?? "user";
      const content = args.slice(2).join(" ");
      if (!content) {
        console.log(chalk.red("Usage: memory create <type> <content>"));
        return;
      }
      const res = await fetch(`${proxyUrl}/api/memory`, {
        method: "POST",
        headers,
        body: JSON.stringify({ type, content }),
      });
      if (!res.ok) {
        console.log(chalk.red("\u2716") + ` Create failed (${res.status})`);
        return;
      }
      console.log(chalk.green("\u2714") + ` Memory created ${colorType(type)}`);
    } else {
      console.log(
        chalk.yellow("Usage: memory [list|index|create <type> <content>]"),
      );
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(chalk.red("\u2716") + ` Memory error: ${msg}`);
    logger.debug("Memory command failed", { error: msg });
  }
}
