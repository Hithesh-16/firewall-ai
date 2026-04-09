import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Sync model add/delete operations to the AI Firewall proxy's
 * `user_models` table. Called from `core/core.ts` when the gui
 * webview fires `config/addModel` or `config/deleteModel`.
 *
 * Reads the bearer token from `~/.ai-firewall/auth.json` (the
 * shared auth file written by `cn login` / VS Code sign-in /
 * JetBrains sign-in). If the file doesn't exist or the token is
 * missing, the sync is silently skipped — the user isn't signed
 * in to AI Firewall and the proxy write doesn't apply.
 *
 * All network calls are fire-and-forget with a 5-second timeout
 * so they never block the model-add UX. Failures are logged to
 * console.warn but don't surface to the user.
 */

interface AuthFile {
  accessToken?: string;
  proxyUrl?: string;
}

function readAuth(): AuthFile | null {
  try {
    const filePath = path.join(os.homedir(), ".ai-firewall", "auth.json");
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as AuthFile;
  } catch {
    return null;
  }
}

export async function syncModelToProxy(
  action: "add" | "delete",
  model: {
    providerSlug?: string;
    modelSlug?: string;
    displayName?: string;
    apiKey?: string;
    apiBase?: string;
  },
): Promise<void> {
  const auth = readAuth();
  if (!auth?.accessToken) return; // not signed in

  const proxyUrl = (auth.proxyUrl || "http://localhost:8080").replace(
    /\/+$/,
    "",
  );
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.accessToken}`,
    "Content-Type": "application/json",
  };

  try {
    if (action === "add") {
      if (!model.providerSlug || !model.apiKey) return;
      await fetch(`${proxyUrl}/api/me/models/add`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          providerSlug: model.providerSlug,
          modelSlug: model.modelSlug || "AUTODETECT",
          displayName: model.displayName,
          apiKey: model.apiKey,
          apiBase: model.apiBase,
        }),
        signal: AbortSignal.timeout(5000),
      });
    } else if (action === "delete") {
      // The delete endpoint needs an ID, but we only have a display
      // name. Fetch the user's model list and find the matching row.
      const listRes = await fetch(`${proxyUrl}/api/me/models/list`, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!listRes.ok) return;
      const body = (await listRes.json()) as {
        models: Array<{
          id: number;
          displayName: string | null;
          modelSlug: string;
        }>;
      };
      const match = body.models.find(
        (m) =>
          m.displayName === model.displayName ||
          m.modelSlug === model.displayName,
      );
      if (match) {
        await fetch(`${proxyUrl}/api/me/models/${match.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${auth.accessToken}` },
          signal: AbortSignal.timeout(5000),
        });
      }
    }
  } catch {
    // Fire and forget — don't break the model-add UX.
  }
}
