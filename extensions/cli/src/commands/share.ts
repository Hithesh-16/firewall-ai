import chalk from "chalk";

import { logger } from "../util/logger.js";

export interface ShareConfig {
  proxyUrl: string;
  token: string;
}

/**
 * Session share: calls /api/commands/execute with /share.
 * Outputs the share URL.
 */
export async function share(
  args: string[],
  config: ShareConfig,
): Promise<void> {
  const { proxyUrl, token } = config;

  console.log(chalk.bold("Generating share link...\n"));

  try {
    const res = await fetch(`${proxyUrl}/api/commands/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ input: "/share" }),
    });

    if (!res.ok) {
      console.log(chalk.red("\u2716") + ` Share failed (${res.status})`);
      return;
    }

    const data = (await res.json()) as {
      success: boolean;
      data?: { output?: string; url?: string };
    };

    if (!data.success) {
      console.log(chalk.yellow("\u26A0") + " Nothing to share");
      return;
    }

    const { url, output } = data.data ?? {};

    if (url) {
      console.log(chalk.green("\u2714") + " Share link created:");
      console.log(chalk.cyan.bold(`  ${url}`));
    } else if (output) {
      console.log(chalk.green("\u2714") + " " + output);
    } else {
      console.log(chalk.green("\u2714") + " Share link generated");
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(chalk.red("\u2716") + ` Share error: ${msg}`);
    logger.debug("Share command failed", { error: msg });
  }
}
