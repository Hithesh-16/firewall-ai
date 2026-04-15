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
 * from `/api/me/policy` and extract both `file_scope.blocklist` AND
 * the flat `blocked_paths` list. The older `/api/file-scope` endpoint
 * returned a global, un-authenticated view that ignored the user's
 * role, so a developer-role policy with `file_scope.blocklist: ["*.env"]`
 * was silently dropped.
 *
 * IMPORTANT: the role-policy schema exposes TWO places where an admin
 * can put file restrictions — `file_scope.blocklist` (glob patterns
 * handled by picomatch) and the flat `blocked_paths` array (also glob
 * patterns in the merged PolicyConfig). The web Role Policies editor
 * at `web/src/pages/security/RolePoliciesPage.tsx` writes into
 * `blocked_paths` for the top-level "Restricted paths" field, while
 * `file_scope.blocklist` is reserved for the advanced editor. We read
 * both here and merge them into a single blocklist — otherwise every
 * path an admin sets from the simple UI is silently ignored in the
 * VS Code client.
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
          policy: {
            file_scope?: FileScope;
            blocked_paths?: string[];
          };
        };
        cachedScope = mergeScope(
          data.policy?.file_scope,
          data.policy?.blocked_paths,
        );
        return;
      }
    }

    const res = await fetch(`${proxyBaseUrl}/api/file-scope`);
    if (res.ok) {
      const data = (await res.json()) as {
        file_scope: FileScope;
        blocked_paths?: string[];
      };
      cachedScope = mergeScope(data.file_scope, data.blocked_paths);
    }
  } catch {
    // Proxy not ready — use empty scope (no restrictions)
  }
}

/**
 * Convert a path-prefix pattern (the format used in `blocked_paths`
 * and the Role Policies UI) into a picomatch-compatible glob.
 *
 * The `blocked_paths` field stores strings like `/payments/`,
 * `/auth/`, `/.env` — intended as "any file under this directory"
 * or "this exact filename". But picomatch needs `**​/payments/**`
 * to match `src/payments/handler.ts` because `isFileRestricted`
 * strips the leading `/` before matching (line 165).
 *
 * Transformation rules:
 *   `/payments/`    → `**​/payments/**`    (directory anywhere)
 *   `/.env`         → `**​/.env`           (file anywhere)
 *   `.env`          → `**​/.env`           (file anywhere, no leading /)
 *   `package.json`  → `**​/package.json`   (file anywhere, no glob chars)
 *   `**​/node_modules/**` → unchanged     (already a glob)
 *   `*.pem`         → unchanged          (already a glob)
 */
function normalizePattern(raw: string): string {
  // Already a glob — has *, ?, {, or starts with **/
  if (/[*?{]/.test(raw)) return raw;
  // Strip leading slash (the match target has no leading /)
  let p = raw.replace(/^\/+/, "");
  if (!p) return raw;
  // Trailing slash → directory pattern
  if (p.endsWith("/")) {
    return `**/${p}**`;
  }
  // No glob chars, no trailing slash → file pattern
  return `**/${p}`;
}

/**
 * Build a unified FileScope from the PolicyConfig's two overlapping
 * restriction fields. De-duplicates patterns so picomatch isn't asked
 * to check the same glob twice.
 *
 * `file_scope.blocklist` patterns are assumed to already be valid
 * picomatch globs (the global policy.json uses `**​/node_modules/**`
 * etc.). `blocked_paths` patterns are path-prefix format and get
 * normalized via `normalizePattern()`.
 */
function mergeScope(
  fileScope: FileScope | undefined,
  blockedPaths: string[] | undefined,
): FileScope {
  const mode: "blocklist" | "allowlist" =
    fileScope?.mode === "allowlist" ? "allowlist" : "blocklist";
  const blocklist = new Set<string>();
  const allowlist = new Set<string>();
  if (fileScope?.blocklist) {
    for (const p of fileScope.blocklist) if (p) blocklist.add(p);
  }
  if (fileScope?.allowlist) {
    for (const p of fileScope.allowlist) if (p) allowlist.add(p);
  }
  if (Array.isArray(blockedPaths)) {
    for (const p of blockedPaths) {
      if (p) blocklist.add(normalizePattern(p));
    }
  }
  return {
    mode,
    blocklist: Array.from(blocklist),
    allowlist: Array.from(allowlist),
  };
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
