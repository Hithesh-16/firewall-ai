import chalk from "chalk";

import { logger } from "../util/logger.js";

export interface CompactConfig {
  proxyUrl: string;
  token: string;
}

/**
 * Context compaction: calls /api/commands/execute with /compact [maxTokens].
 * Shows token savings after compaction.
 */
export async function compact(
  args: string[],
  config: CompactConfig,
): Promise<void> {
  const { proxyUrl, token } = config;
  const maxTokens = args[0] ?? "";
  const input = maxTokens ? `/compact ${maxTokens}` : "/compact";

  console.log(chalk.bold("Compacting conversation context...\n"));

  try {
    const res = await fetch(`${proxyUrl}/api/commands/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ input }),
    });

    if (!res.ok) {
      console.log(chalk.red("\u2716") + ` Compact failed (${res.status})`);
      return;
    }

    const data = (await res.json()) as {
      success: boolean;
      data?: {
        output?: string;
        tokensBefore?: number;
        tokensAfter?: number;
      };
    };

    if (!data.success) {
      console.log(chalk.yellow("\u26A0") + " No context to compact");
      return;
    }

    const { tokensBefore, tokensAfter, output } = data.data ?? {};

    if (tokensBefore && tokensAfter) {
      const saved = tokensBefore - tokensAfter;
      const pct = Math.round((saved / tokensBefore) * 100);
      console.log(
        chalk.green("\u2714") +
          ` Tokens: ${tokensBefore} \u2192 ${tokensAfter}`,
      );
      console.log(chalk.green(`  Saved: ${saved} tokens (${pct}%)`));
    }

    if (output) {
      console.log(chalk.dim("\n" + output));
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(chalk.red("\u2716") + ` Compact error: ${msg}`);
    logger.debug("Compact command failed", { error: msg });
  }
}
