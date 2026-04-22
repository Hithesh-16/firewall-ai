/**
 * @ai-firewall/shared-auth
 *
 * Shared authentication primitives used by the CLI, VS Code, and JetBrains
 * surfaces to implement web-first sign-in.
 *
 * Three concerns, one package:
 *
 *   1. On-disk auth file — `~/.ai-firewall/auth.json` (chmod 600). The
 *      primary storage location for the CLI; a bonus fallback for the
 *      editor extensions when the proxy is local.
 *   2. Loopback callback server — a tiny HTTP server on `127.0.0.1:<port>`
 *      that the web dashboard POSTs the token to after a successful login.
 *   3. Web-login URL builder — formats the `${proxyUrl}/web-login-start?...`
 *      link that every extension opens in the browser.
 *
 * Zero runtime dependencies. Safe to consume from any Node context.
 */

export type {
  AuthSource,
  UserRole,
  SharedAuthUser,
  SharedAuthFile,
  WebLoginReturnChannel,
  BuildWebLoginUrlOptions,
} from "./types.js";

export {
  getAuthFilePath,
  getAuthRootDir,
  loadAuthFile,
  saveAuthFile,
  deleteAuthFile,
  clearUserArtefacts,
  isAuthValid,
  watchAuthFile,
  normalizeAuthFile,
} from "./authFile.js";

export { buildWebLoginUrl, generateStateNonce } from "./webLoginUrl.js";

export {
  mergeLocalIntoAssistantYaml,
  scanLocalCustomisations,
  type LocalCustomisations,
} from "./localMerge.js";

export {
  startLoopbackTokenServer,
  DEFAULT_LOOPBACK_PORTS,
  type StartLoopbackServerOptions,
  type LoopbackResult,
} from "./loopbackServer.js";
