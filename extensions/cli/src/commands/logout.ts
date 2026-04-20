import { deleteAuthFile, loadAuthFile } from "@ai-firewall/shared-auth";
import chalk from "chalk";

import { logout as legacyWorkosLogout } from "../auth/workos.js";

/**
 * Phase 5 — CLI sign-out.
 *
 * Three steps, in order, every one best-effort so a failure on step 1
 * or step 2 doesn't prevent the local cache from being wiped:
 *
 *   1. POST /api/auth/logout → server-side token revocation
 *      (the proxy removes the row from api_tokens).
 *
 *   2. DELETE /api/auth/handoff → clear the shared auth file
 *      via the proxy, which is the right call when the proxy
 *      is running locally and wrote the file in the first place.
 *      Non-local proxies return 403 — that's fine, we fall
 *      through to step 3.
 *
 *   3. Local cleanup: delete the shared auth file from disk
 *      and run the legacy WorkOS logout (which clears any
 *      sidecar state the CLI still maintains).
 *
 * The user sees one line of output regardless of which step
 * actually did the work.
 */
export async function logout(): Promise<void> {
  const existing = loadAuthFile();
  const token = existing?.accessToken;
  const proxyUrl = existing?.proxyUrl || "http://localhost:8080";

  // Step 1 — proxy revoke
  if (token) {
    try {
      await fetch(`${proxyUrl}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      /* proxy may be offline — continue */
    }
  }

  // Step 2 — DELETE the shared file via the proxy (only works when
  // the proxy is local; remote proxies refuse with 403, which is
  // expected).
  if (token) {
    try {
      await fetch(`${proxyUrl}/api/auth/handoff`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      /* ignore — step 3 handles the actual cleanup */
    }
  }

  // Step 3 — local cleanup. Always runs, even if the proxy calls
  // above failed.
  try {
    deleteAuthFile();
  } catch {
    /* ignore — maybe the file wasn't there */
  }
  try {
    legacyWorkosLogout();
  } catch {
    /* ignore — legacy sidecar cleanup is best-effort */
  }

  console.info(chalk.green("Signed out of AI Firewall."));
}
