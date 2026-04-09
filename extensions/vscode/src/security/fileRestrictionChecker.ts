/**
 * File Restriction Checker — VS Code Extension
 *
 * Fetches file scope policy from the AI Firewall proxy on startup
 * and checks files locally before they are included in AI requests.
 * Prevents restricted files from being sent to the proxy in the first place.
 */

import * as vscode from "vscode";

// picomatch glob matching — use dynamic require to avoid type declaration issues
function isMatch(
  path: string,
  pattern: string,
  options?: { dot?: boolean },
): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const picomatch = require("picomatch");
    return picomatch.isMatch(path, pattern, options);
  } catch {
    // Fallback: simple glob matching for common patterns
    const regex = new RegExp(
      "^" +
        pattern
          .replace(/\*\*/g, ".*")
          .replace(/\*/g, "[^/]*")
          .replace(/\?/g, ".") +
        "$",
    );
    return regex.test(path);
  }
}

interface FileScope {
  mode: "blocklist" | "allowlist";
  blocklist: string[];
  allowlist: string[];
}

let cachedScope: FileScope | null = null;
let proxyBaseUrl = "http://localhost:8080";
let cachedBearer: string | null = null;

/**
 * Phase E: fetch the caller's **effective** policy (role + org merged)
 * from `/api/me/policy` and extract `file_scope`. The older
 * `/api/file-scope` endpoint returned a global, un-authenticated
 * view that ignored the user's role, so a developer-role policy
 * with `file_scope.blocklist: ["*.env"]` was silently dropped.
 *
 * Call this twice:
 *   1. At startup with no token (falls back to org defaults where
 *      `/api/me/policy` is unavailable).
 *   2. After `AiFirewallAuthService.signIn()` succeeds — pass the
 *      bearer token so the effective policy reflects the signed-in
 *      user's role.
 *
 * Also wired to `onDidChangeAuth` so sign-out clears the cache
 * and sign-in refreshes it.
 */
export async function refreshFileScope(
  proxyUrl?: string,
  bearerToken?: string,
): Promise<void> {
  if (proxyUrl) proxyBaseUrl = proxyUrl;
  if (bearerToken !== undefined) cachedBearer = bearerToken;

  // Prefer the authenticated effective policy endpoint when we
  // have a token; fall back to the legacy unauthenticated scope
  // endpoint when we don't (e.g. during extension activation
  // before the user has signed in).
  try {
    if (cachedBearer) {
      const res = await fetch(`${proxyBaseUrl}/api/me/policy`, {
        headers: { Authorization: `Bearer ${cachedBearer}` },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          policy: { file_scope?: FileScope };
        };
        cachedScope = data.policy?.file_scope ?? null;
        return;
      }
    }

    const res = await fetch(`${proxyBaseUrl}/api/file-scope`);
    if (res.ok) {
      const data = (await res.json()) as { file_scope: FileScope };
      cachedScope = data.file_scope;
    }
  } catch {
    // Proxy not ready — use empty scope (no restrictions)
  }
}

/**
 * Clear the cached file scope. Called from AiFirewallAuthService
 * sign-out so a freshly-anonymous VS Code process doesn't keep
 * enforcing the previously-signed-in user's role policy.
 */
export function clearFileScope(): void {
  cachedScope = null;
  cachedBearer = null;
}

/**
 * Check if a file is restricted by the proxy's file scope policy.
 * Returns true if the file should NOT be included in AI context.
 */
export function isFileRestricted(filePath: string): boolean {
  if (!cachedScope) return false;

  // Normalize to relative-style path for glob matching
  const normalized = filePath.replace(/\\/g, "/").replace(/^\//, "");

  if (cachedScope.mode === "allowlist" && cachedScope.allowlist.length > 0) {
    const allowed = cachedScope.allowlist.some((pattern) =>
      isMatch(normalized, pattern, { dot: true }),
    );
    return !allowed;
  }

  return cachedScope.blocklist.some((pattern) =>
    isMatch(normalized, pattern, { dot: true }),
  );
}

/**
 * Get the restriction reason for a file (for UI display).
 */
export function getRestrictionReason(filePath: string): string | null {
  if (!cachedScope) return null;

  const normalized = filePath.replace(/\\/g, "/").replace(/^\//, "");

  if (cachedScope.mode === "allowlist" && cachedScope.allowlist.length > 0) {
    const allowed = cachedScope.allowlist.some((pattern) =>
      isMatch(normalized, pattern, { dot: true }),
    );
    if (!allowed) return "File is not in the allowed file list";
  }

  for (const pattern of cachedScope.blocklist) {
    if (isMatch(normalized, pattern, { dot: true })) {
      return `File matches restricted pattern: ${pattern}`;
    }
  }

  return null;
}

/**
 * Show a VS Code warning if a file is restricted.
 * Returns true if restricted (caller should skip including the file).
 */
export function warnIfRestricted(filePath: string): boolean {
  const reason = getRestrictionReason(filePath);
  if (reason) {
    vscode.window
      .showWarningMessage(
        `AI Firewall: ${reason}. This file will not be included in AI context.`,
        "Open Security Settings",
      )
      .then((choice) => {
        if (choice === "Open Security Settings") {
          vscode.commands.executeCommand("aiFirewall.aiFirewallGUIView.focus");
        }
      });
    return true;
  }
  return false;
}
