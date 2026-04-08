import * as http from "http";
import { AddressInfo } from "net";

/**
 * Default port range for loopback token receivers. Extensions iterate from
 * the first port upwards until they find a free one, so two `cn login`
 * instances running side-by-side don't collide.
 *
 *   CLI       — prefers 19836
 *   JetBrains — prefers 19837
 */
export const DEFAULT_LOOPBACK_PORTS = {
  cli: 19836,
  jetbrains: 19837,
} as const;

export interface StartLoopbackServerOptions {
  /** The first port to try. */
  port: number;
  /** How many consecutive ports to try before giving up. Default: 10. */
  portRange?: number;
  /**
   * Required state nonce — the browser callback MUST include `?state=<nonce>`
   * and it MUST match, otherwise the request is rejected with 400.
   * If omitted, state-checking is disabled (NOT recommended).
   */
  state?: string;
  /** Milliseconds to wait before rejecting with a timeout error. Default: 5 min. */
  timeoutMs?: number;
}

export interface LoopbackResult {
  token: string;
  /** The port the server actually bound to (may differ from `port` if fallback kicked in). */
  port: number;
}

const HTML_SUCCESS = `<!doctype html>
<html><head><meta charset="utf-8"><title>Signed in</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0f19;color:#e5e7eb;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#111827;border:1px solid #1f2937;border-radius:16px;padding:32px 40px;text-align:center;max-width:420px}
h1{margin:0 0 8px;font-size:20px;color:#34d399}
p{margin:0;color:#9ca3af;font-size:14px}</style></head>
<body><div class="card"><h1>You're signed in</h1><p>You can close this tab and return to your editor.</p></div></body></html>`;

const HTML_ERROR = `<!doctype html>
<html><head><meta charset="utf-8"><title>Sign-in failed</title></head>
<body style="font-family:system-ui,sans-serif">Sign-in failed. Please return to your editor and try again.</body></html>`;

/**
 * Starts a loopback HTTP server that waits for a single `?token=...` query
 * param, then resolves with the token and shuts down.
 *
 * Design notes:
 *   - Binds to `127.0.0.1` only — never `0.0.0.0`. Other machines on the LAN
 *     cannot reach this server.
 *   - Accepts exactly one successful request then closes.
 *   - Sends permissive CORS headers so the web dashboard (running on any
 *     origin) can `fetch(...)` it from the browser.
 *   - Returns the final bound port so the caller can embed it in the
 *     web-login URL even when the preferred port was taken.
 */
export function startLoopbackTokenServer(
  options: StartLoopbackServerOptions,
): Promise<LoopbackResult> & { stop: () => void } {
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
  const range = options.portRange ?? 10;

  let server: http.Server | null = null;
  let timeoutHandle: NodeJS.Timeout | null = null;
  let settled = false;

  const stop = () => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (server) {
      try {
        server.close();
      } catch {
        /* ignore */
      }
      server = null;
    }
  };

  const promise = new Promise<LoopbackResult>((resolve, reject) => {
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
      stop();
    };

    server = http.createServer((req, res) => {
      // CORS preflight
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      try {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        const token = url.searchParams.get("token");
        const state = url.searchParams.get("state");

        if (options.state && state !== options.state) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(HTML_ERROR);
          finish(() => reject(new Error("state nonce mismatch")));
          return;
        }
        if (!token) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(HTML_ERROR);
          finish(() => reject(new Error("missing token query param")));
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(HTML_SUCCESS);
        const addr = server?.address() as AddressInfo | null;
        finish(() => resolve({ token, port: addr?.port ?? options.port }));
      } catch (err) {
        res.writeHead(500);
        res.end();
        finish(() =>
          reject(err instanceof Error ? err : new Error(String(err))),
        );
      }
    });

    // Iterate port range looking for a free slot
    let tryPort = options.port;
    const attempt = () => {
      if (!server) return;
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && tryPort - options.port < range - 1) {
          tryPort += 1;
          setImmediate(attempt);
        } else {
          finish(() => reject(err));
        }
      });
      server.listen(tryPort, "127.0.0.1");
    };
    attempt();

    timeoutHandle = setTimeout(() => {
      finish(() => reject(new Error("loopback token server timed out")));
    }, timeoutMs);
  });

  return Object.assign(promise, { stop });
}
