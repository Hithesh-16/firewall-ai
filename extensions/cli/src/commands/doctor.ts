import chalk from "chalk";

import { logger } from "../util/logger.js";

export interface DoctorConfig {
  proxyUrl: string;
  token: string;
}

/**
 * Health check: calls proxy /health and /api/commands/execute with /doctor.
 */
export async function doctor(
  args: string[],
  config: DoctorConfig,
): Promise<void> {
  const { proxyUrl, token } = config;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  // Step 1: Health check
  console.log(chalk.bold("Running health check...\n"));

  try {
    const healthRes = await fetch(`${proxyUrl}/health`, { headers });
    if (healthRes.ok) {
      console.log(chalk.green("\u2714") + " Proxy is reachable");
    } else {
      console.log(chalk.red("\u2716") + ` Proxy returned ${healthRes.status}`);
      return;
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(chalk.red("\u2716") + ` Cannot reach proxy: ${msg}`);
    logger.debug("Doctor health check failed", { error: msg });
    return;
  }

  // Step 2: Run /doctor command
  try {
    const res = await fetch(`${proxyUrl}/api/commands/execute`, {
      method: "POST",
      headers,
      body: JSON.stringify({ input: "/doctor" }),
    });

    if (!res.ok) {
      console.log(chalk.red("\u2716") + " /doctor command failed");
      return;
    }

    const data = (await res.json()) as {
      success: boolean;
      data?: { output?: string };
    };

    if (data.success && data.data?.output) {
      console.log(chalk.dim("\n--- Diagnostics ---"));
      console.log(data.data.output);
    } else {
      console.log(chalk.green("\u2714") + " All systems operational");
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(chalk.red("\u2716") + ` Doctor command error: ${msg}`);
    logger.debug("Doctor command failed", { error: msg });
  }
}
