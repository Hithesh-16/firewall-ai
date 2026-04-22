import chalk from "chalk";
import { loadAuthFile } from "@ai-firewall/shared-auth";

/**
 * `cn models` — list the current user's models.
 *
 * Read-only by design. Models are managed at Settings → Models in
 * the web dashboard; this command just shows what's currently bound
 * to your account so you can confirm a `/sync` pulled the expected
 * list. Print format:
 *
 *   ✓ GPT-4o               openai/gpt-4o                 (self)
 *   ✓ Claude Sonnet        anthropic/claude-sonnet-...   (granted by admin)
 *
 * Source: `GET /api/me/models/list` on the proxy.
 */

interface ModelRow {
  id: number;
  providerSlug: string;
  modelSlug: string;
  displayName: string | null;
  apiBase: string | null;
  enabled: boolean;
  roles: string[];
  createdBy: number | null;
}

interface ListResponse {
  models: ModelRow[];
  hasAny: boolean;
}

export async function models(): Promise<void> {
  const auth = loadAuthFile();
  if (!auth?.accessToken) {
    console.error(
      chalk.red(
        "Not signed in. Run `cn login` first, or check that your session file exists at ~/.ai-firewall/auth.json.",
      ),
    );
    process.exit(1);
    return;
  }

  const proxyUrl = auth.proxyUrl || "http://localhost:8080";
  let res: Response;
  try {
    res = await fetch(`${proxyUrl}/api/me/models/list`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
  } catch (e) {
    console.error(
      chalk.red(
        `Could not reach the proxy at ${proxyUrl}: ${
          e instanceof Error ? e.message : e
        }`,
      ),
    );
    process.exit(1);
    return;
  }
  if (!res.ok) {
    console.error(
      chalk.red(`Proxy returned HTTP ${res.status} ${res.statusText}`),
    );
    process.exit(1);
    return;
  }
  const body = (await res.json()) as ListResponse;

  if (body.models.length === 0) {
    console.info(
      chalk.yellow(
        "No models yet. Add one at Settings → Models in the web dashboard, or ask your org admin to assign you access.",
      ),
    );
    return;
  }

  console.info(
    chalk.bold(`\nModels bound to ${auth.user.email}`) +
      chalk.dim(`  ·  edit at Settings → Models in the web dashboard\n`),
  );
  const width =
    Math.max(...body.models.map((m) => (m.displayName || m.modelSlug).length)) +
    2;
  for (const m of body.models) {
    const name = (m.displayName || m.modelSlug).padEnd(width);
    const pair = `${m.providerSlug}/${m.modelSlug}`.padEnd(40);
    const source =
      m.createdBy === null
        ? chalk.dim("(legacy)")
        : m.createdBy === auth.user.id
          ? chalk.dim("(self)")
          : chalk.dim("(granted by admin)");
    console.info(`  ${chalk.green("✓")} ${name} ${chalk.cyan(pair)} ${source}`);
  }
  console.info("");
}
