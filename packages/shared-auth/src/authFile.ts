import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import type { SharedAuthFile, SharedAuthUser, AuthSource } from "./types.js";

/**
 * Returns the absolute path of the shared auth file.
 *
 * Resolution order:
 *   1. `$AI_FIREWALL_GLOBAL_DIR/auth.json` (explicit override, used by tests)
 *   2. `~/.ai-firewall/auth.json`
 */
export function getAuthFilePath(): string {
  const dir =
    process.env.AI_FIREWALL_GLOBAL_DIR ||
    path.join(os.homedir(), ".ai-firewall");
  return path.join(dir, "auth.json");
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Normalizes an on-disk object into a {@link SharedAuthFile}.
 *
 * Accepts the legacy CLI shape `{ userId, userEmail, accessToken, ... }` and
 * maps it onto the canonical v1 structure so older CLI installs keep working.
 *
 * Returns `null` if the payload is not recognizable as an auth file.
 */
export function normalizeAuthFile(raw: unknown): SharedAuthFile | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const accessToken =
    typeof obj.accessToken === "string" ? obj.accessToken : null;
  if (!accessToken) return null;

  // Already canonical v1?
  if (obj.version === 1 && obj.user && typeof obj.user === "object") {
    const user = obj.user as Record<string, unknown>;
    const normalizedUser: SharedAuthUser = {
      id: Number(user.id) || 0,
      email: String(user.email || ""),
      name: typeof user.name === "string" ? user.name : undefined,
      role: (user.role as SharedAuthUser["role"]) || "developer",
      orgId:
        typeof user.orgId === "number"
          ? user.orgId
          : user.orgId == null
            ? null
            : Number(user.orgId) || null,
    };
    return {
      version: 1,
      proxyUrl:
        typeof obj.proxyUrl === "string"
          ? obj.proxyUrl
          : "http://localhost:8080",
      accessToken,
      user: normalizedUser,
      expiresAt: typeof obj.expiresAt === "number" ? obj.expiresAt : undefined,
      savedAt: typeof obj.savedAt === "number" ? obj.savedAt : Date.now(),
      savedBy: (obj.savedBy as AuthSource) || "cli",
      onboardingComplete:
        typeof obj.onboardingComplete === "boolean"
          ? obj.onboardingComplete
          : undefined,
    };
  }

  // Legacy CLI shape — { userId, userEmail, accessToken, organizationId, expiresAt, ... }
  const legacyId = obj.userId;
  const legacyEmail = obj.userEmail;
  if (legacyId !== undefined || legacyEmail !== undefined) {
    return {
      version: 1,
      proxyUrl: "http://localhost:8080",
      accessToken,
      user: {
        id: Number(legacyId) || 0,
        email: typeof legacyEmail === "string" ? legacyEmail : "",
        role: "developer",
        orgId:
          typeof obj.organizationId === "number"
            ? obj.organizationId
            : typeof obj.organizationId === "string"
              ? Number(obj.organizationId) || null
              : null,
      },
      expiresAt: typeof obj.expiresAt === "number" ? obj.expiresAt : undefined,
      savedAt: Date.now(),
      savedBy: "cli",
    };
  }

  return null;
}

/**
 * Reads the shared auth file. Returns `null` if missing, unreadable,
 * or unparseable. Does NOT throw.
 */
export function loadAuthFile(
  filePath: string = getAuthFilePath(),
): SharedAuthFile | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return null;
    const parsed = JSON.parse(raw);
    return normalizeAuthFile(parsed);
  } catch {
    return null;
  }
}

/**
 * Writes the shared auth file atomically with `0600` permissions.
 *
 * Strategy:
 *   1. Write to `<path>.tmp` (created with mode 0600).
 *   2. `fs.renameSync` onto the final path — atomic on POSIX.
 *   3. `fs.chmodSync` again as a belt-and-braces guarantee.
 */
export function saveAuthFile(
  auth: SharedAuthFile,
  filePath: string = getAuthFilePath(),
): void {
  ensureDir(filePath);
  const tmp = `${filePath}.tmp`;
  const payload = JSON.stringify(auth, null, 2);
  // { mode: 0o600 } only applies at creation — ensure we're creating fresh.
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeSync(fd, payload);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* Windows: chmod is a no-op; ignore */
  }
}

/**
 * Deletes the shared auth file if it exists. Idempotent; never throws.
 */
export function deleteAuthFile(filePath: string = getAuthFilePath()): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Returns the root `~/.ai-firewall/` directory (or the
 * `$AI_FIREWALL_GLOBAL_DIR` override used by tests).
 */
export function getAuthRootDir(): string {
  return (
    process.env.AI_FIREWALL_GLOBAL_DIR ||
    path.join(os.homedir(), ".ai-firewall")
  );
}

/**
 * Remove every user-identity-bound artefact written under
 * `~/.ai-firewall/`. Called from every sign-out flow (web, CLI,
 * VS Code) and whenever the file watcher sees the accessToken
 * change to a different user — otherwise stale models, sessions,
 * and sync caches from the previous account linger and surface in
 * the IDE / CLI on the next sign-in.
 *
 * Wipes:
 *   - auth.json                        (bearer token)
 *   - config.yaml                      (synced assistant — unless
 *                                       marked `# user-managed: true`)
 *   - cache/                           (assistant.yaml, etag, meta,
 *                                       vscode-assistant.etag)
 *   - sessions/                        (CLI chat history)
 *   - cli-state.json                   (legacy WorkOS sidecar)
 *
 * Preserves (not identity-bound):
 *   - permissions.yaml, settings.json, .env, memory/
 *
 * Idempotent. Never throws — every step is wrapped individually so
 * a single permissions error on one file doesn't block the rest.
 */
export function clearUserArtefacts(rootDir: string = getAuthRootDir()): void {
  const safeUnlink = (p: string): void => {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* best-effort */
    }
  };
  const safeRmDir = (p: string): void => {
    try {
      if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  };

  safeUnlink(path.join(rootDir, "auth.json"));
  safeUnlink(path.join(rootDir, "cli-state.json"));

  // Respect a hand-edited config.yaml that opted out of auto-sync.
  try {
    const configPath = path.join(rootDir, "config.yaml");
    if (fs.existsSync(configPath)) {
      const head = fs.readFileSync(configPath, "utf8").slice(0, 200);
      if (!head.includes("# user-managed: true")) {
        fs.unlinkSync(configPath);
      }
    }
  } catch {
    /* best-effort */
  }

  safeRmDir(path.join(rootDir, "cache"));
  safeRmDir(path.join(rootDir, "sessions"));
}

/**
 * Returns `true` if the auth record has an access token and is not expired.
 *
 * A record with `expiresAt` unset or `0` is treated as non-expiring.
 */
export function isAuthValid(auth: SharedAuthFile | null): boolean {
  if (!auth || !auth.accessToken) return false;
  if (!auth.expiresAt) return true;
  return auth.expiresAt > Date.now();
}

/**
 * Watches the shared auth file and fires `cb` whenever it changes.
 *
 * Uses `fs.watch` for responsiveness and a 2-second `stat` poll as a
 * fallback on platforms where `fs.watch` is flaky (macOS, network drives).
 * Changes are debounced by 100 ms so rapid atomic-rename sequences surface
 * as a single event.
 *
 * Returns a disposer function.
 */
export function watchAuthFile(
  cb: (auth: SharedAuthFile | null) => void,
  filePath: string = getAuthFilePath(),
): () => void {
  let disposed = false;
  let debounce: NodeJS.Timeout | null = null;
  let lastMtime = 0;

  const fire = () => {
    if (disposed) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (disposed) return;
      cb(loadAuthFile(filePath));
    }, 100);
  };

  // fs.watch on the directory (survives rename/replace of the file itself)
  let watcher: fs.FSWatcher | null = null;
  try {
    ensureDir(filePath);
    watcher = fs.watch(path.dirname(filePath), (_event, changed) => {
      if (!changed || changed === path.basename(filePath)) fire();
    });
    watcher.on("error", () => {
      /* fall through to polling */
    });
  } catch {
    /* fall through to polling */
  }

  // 2-second stat poll fallback
  const poll = setInterval(() => {
    if (disposed) return;
    try {
      const stat = fs.statSync(filePath);
      const mtime = stat.mtimeMs;
      if (mtime !== lastMtime) {
        lastMtime = mtime;
        fire();
      }
    } catch {
      if (lastMtime !== 0) {
        lastMtime = 0;
        fire(); // file disappeared
      }
    }
  }, 2000);

  return () => {
    disposed = true;
    if (debounce) clearTimeout(debounce);
    if (watcher) {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
    }
    clearInterval(poll);
  };
}
