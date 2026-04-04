import chalk from "chalk";

import { logger } from "../util/logger.js";

export interface ResumeConfig {
  proxyUrl: string;
  token: string;
}

/**
 * Session restore: calls /api/commands/execute with /resume.
 * Displays restored session info.
 */
export async function resume(
  args: string[],
  config: ResumeConfig,
): Promise<void> {
  const { proxyUrl, token } = config;

  console.log(chalk.bold("Restoring last session...\n"));

  try {
    const res = await fetch(`${proxyUrl}/api/commands/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ input: "/resume" }),
    });

    if (!res.ok) {
      console.log(chalk.red("\u2716") + ` Resume failed (${res.status})`);
      return;
    }

    const data = (await res.json()) as {
      success: boolean;
      data?: {
        output?: string;
        sessionId?: string;
        messageCount?: number;
        model?: string;
      };
    };

    if (!data.success) {
      console.log(chalk.yellow("\u26A0") + " No previous session found");
      return;
    }

    const { sessionId, messageCount, model, output } = data.data ?? {};

    console.log(chalk.green("\u2714") + " Session restored");
    if (sessionId) {
      console.log(chalk.dim(`  Session: ${sessionId}`));
    }
    if (messageCount) {
      console.log(chalk.dim(`  Messages: ${messageCount}`));
    }
    if (model) {
      console.log(chalk.dim(`  Model: ${model}`));
    }
    if (output) {
      console.log(chalk.dim("\n" + output));
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(chalk.red("\u2716") + ` Resume error: ${msg}`);
    logger.debug("Resume command failed", { error: msg });
  }
}
