import chalk from "chalk";
import { loadAuthFile } from "@ai-firewall/shared-auth";

/**
 * `cn rules` / `cn skills` — read-only listings of the org catalogue
 * the caller can install.
 *
 * Mirrors `cn models`: editing happens in the web dashboard (admins
 * author under Org Settings → Rules/Skills, users install under
 * Settings → Rules/Skills). These commands let power users eyeball
 * the same data from a terminal without switching contexts.
 *
 * The catalogue endpoint also returns items the user has installed
 * as markdown files under ~/.ai-firewall/{rules,skills}/ — those
 * are mirrored by the proxy on install and read by Continue core
 * on every reload.
 *
 * Source: `GET /api/me/rules` and `GET /api/me/skills`.
 */

interface CatalogueRow {
  id: number;
  orgId: number;
  slug: string;
  title: string;
  description: string | null;
  body: string;
  installed: boolean;
  enabled: boolean;
}

interface ListResponse {
  items: CatalogueRow[];
}

type Kind = "rule" | "skill";

async function runListing(kind: Kind): Promise<void> {
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
  const path = kind === "rule" ? "/api/me/rules" : "/api/me/skills";
  let res: Response;
  try {
    res = await fetch(`${proxyUrl}${path}`, {
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
  const label = kind === "rule" ? "rule" : "skill";
  const labelPlural = kind === "rule" ? "rules" : "skills";

  if (body.items.length === 0) {
    console.info(
      chalk.yellow(
        `No org ${labelPlural} available. Ask your admin to add some under Org Settings → ${
          label.charAt(0).toUpperCase() + label.slice(1)
        }s in the web dashboard.`,
      ),
    );
    console.info(
      chalk.dim(
        `\nPersonal ${labelPlural}? Drop markdown files into ~/.ai-firewall/${
          kind === "rule" ? "rules/" : "skills/<slug>/"
        } — they're picked up automatically, never uploaded.`,
      ),
    );
    return;
  }

  console.info(
    chalk.bold(
      `\n${label.charAt(0).toUpperCase() + label.slice(1)} catalogue for ${auth.user.email}`,
    ) + chalk.dim(`  ·  install at Settings → ${labelPlural} in the web\n`),
  );

  const titleWidth = Math.max(...body.items.map((r) => r.title.length)) + 2;
  const slugWidth = Math.max(...body.items.map((r) => r.slug.length)) + 2;

  for (const item of body.items) {
    const marker = item.installed ? chalk.green("✓") : chalk.dim("·");
    const name = item.title.padEnd(titleWidth);
    const slug = chalk.cyan(item.slug.padEnd(slugWidth));
    const state = item.installed
      ? chalk.dim(`(installed${item.enabled ? "" : ", disabled"})`)
      : chalk.dim("(not installed)");
    console.info(`  ${marker} ${name} ${slug} ${state}`);
    if (item.description) {
      console.info(`     ${chalk.dim(item.description)}`);
    }
  }

  console.info(
    chalk.dim(
      `\nPersonal ${labelPlural}? Drop markdown files into ~/.ai-firewall/${
        kind === "rule" ? "rules/" : "skills/<slug>/"
      } — they're picked up automatically, never uploaded.\n`,
    ),
  );
}

export function rules(): Promise<void> {
  return runListing("rule");
}

export function skills(): Promise<void> {
  return runListing("skill");
}
