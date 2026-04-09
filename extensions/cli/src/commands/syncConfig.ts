import { loadAuthFile } from "@ai-firewall/shared-auth";
import chalk from "chalk";

import { syncLocalConfigYamlToApi } from "../apiAssistantLoader.js";
import { gracefulExit } from "../util/exit.js";

/**
 * Phase G — `cn sync-config` top-level subcommand.
 *
 * A one-shot explicit migration from the legacy
 * `~/.ai-firewall/config.yaml` file to the proxy's
 * `assistants` table. Users can run this any time after `cn login`
 * to seed the proxy without waiting for the automatic 404 fallback
 * in the config loader to kick in.
 *
 * What it does:
 *
 *   1. Reads the shared auth file (fails if not signed in).
 *   2. Uploads `~/.ai-firewall/config.yaml` via
 *      `PUT /api/me/assistants/default` — creating or replacing
 *      the user's default personal assistant.
 *   3. Prints a success line pointing at the web dashboard for
 *      further edits.
 *
 * After a successful sync, setting `AI_FIREWALL_USE_API_ASSISTANT=1`
 * makes the CLI load the migrated assistant from the proxy on
 * next boot instead of the local file.
 */
export async function syncConfigCommand(): Promise<void> {
  const auth = loadAuthFile();
  if (!auth || !auth.accessToken) {
    console.error(
      chalk.red(
        "Not signed in. Run `cn login` first, then re-run `cn sync-config`.",
      ),
    );
    await gracefulExit(1);
    return;
  }

  const proxyUrl = auth.proxyUrl || "http://localhost:8080";
  const ok = await syncLocalConfigYamlToApi(proxyUrl, auth.accessToken);
  if (!ok) {
    console.error(
      chalk.red(
        "Migration failed. Check that ~/.ai-firewall/config.yaml exists " +
          "and the proxy is running at " +
          proxyUrl +
          ".",
      ),
    );
    await gracefulExit(1);
    return;
  }

  console.info(
    chalk.dim(
      "\nNext steps:\n" +
        "  • Set AI_FIREWALL_USE_API_ASSISTANT=1 in your shell to load " +
        "from the proxy.\n" +
        "  • Edit your assistant in the AI Firewall web dashboard → Settings → Assistant.\n" +
        "  • Your legacy ~/.ai-firewall/config.yaml is left on disk as a " +
        "backup — you can delete it once you're happy with the migration.",
    ),
  );
}
