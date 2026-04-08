import type { BuildWebLoginUrlOptions } from "./types.js";

/**
 * Builds the URL an extension should open in the user's browser to start the
 * web-first sign-in flow.
 *
 * The URL targets the proxy's `/web-login-start` bridge (see
 * `proxy/src/routes/webLoginBridge.route.ts`) which stashes the callback info
 * in a short-lived signed cookie and 302s the user to the web dashboard's
 * `/login?from=extension` page. After successful sign-in the dashboard reads
 * the cookie and delivers the token back to the extension via the declared
 * channel (vscode:// URI or `127.0.0.1:<port>` loopback).
 *
 * Example:
 *   buildWebLoginUrl({
 *     proxyUrl: "https://firewall.acme.com",
 *     return: "cli",
 *     port: 19836,
 *     state: "a1b2c3",
 *   })
 *   => "https://firewall.acme.com/web-login-start?return=cli&port=19836&state=a1b2c3"
 */
export function buildWebLoginUrl(opts: BuildWebLoginUrlOptions): string {
  const base = opts.proxyUrl.replace(/\/+$/, "");
  const params = new URLSearchParams();
  params.set("return", opts.return);
  if (opts.callback) params.set("callback", opts.callback);
  if (typeof opts.port === "number") params.set("port", String(opts.port));
  if (opts.state) params.set("state", opts.state);
  return `${base}/web-login-start?${params.toString()}`;
}

/**
 * Generates an unguessable state nonce (base36, ~72 bits of entropy).
 * Node's `crypto.randomUUID` would work too; we avoid importing it to keep
 * this module usable in pre-18 runtimes.
 */
export function generateStateNonce(): string {
  const bytes: string[] = [];
  for (let i = 0; i < 12; i++) {
    bytes.push(Math.floor(Math.random() * 36).toString(36));
  }
  return bytes.join("");
}
