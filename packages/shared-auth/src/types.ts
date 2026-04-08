/**
 * Types for the shared-auth package.
 *
 * The SharedAuthFile is the on-disk format of `~/.ai-firewall/auth.json`,
 * written by the CLI, VS Code extension, JetBrains plugin, and the proxy's
 * handoff endpoint. It is a bearer-token file — treat it like a secret
 * (chmod 600, never commit, never log raw).
 */

export type AuthSource = "web" | "cli" | "vscode" | "jetbrains" | "proxy";

export type UserRole = "admin" | "security_lead" | "developer" | "auditor";

export interface SharedAuthUser {
  id: number;
  email: string;
  name?: string;
  role: UserRole;
  orgId?: number | null;
}

/**
 * On-disk auth file format, version 1.
 *
 * NOTE: aliases are resolved on read for backward-compatibility with the
 * legacy CLI format (`userId`, `userEmail`, `organizationId`).
 */
export interface SharedAuthFile {
  version: 1;
  /** The base URL of the proxy this token is valid for. */
  proxyUrl: string;
  /** The raw `afw_...` bearer token. */
  accessToken: string;
  user: SharedAuthUser;
  /** Unix epoch millis. `0` or missing means "no explicit expiry". */
  expiresAt?: number;
  /** Unix epoch millis the file was written. */
  savedAt: number;
  savedBy: AuthSource;
  /** Mirrors `users.onboarding_complete` so extensions can skip the dashboard redirect. */
  onboardingComplete?: boolean;
}

/** A return channel an extension uses to receive the token after web sign-in. */
export type WebLoginReturnChannel = "cli" | "vscode" | "jetbrains";

export interface BuildWebLoginUrlOptions {
  proxyUrl: string;
  return: WebLoginReturnChannel;
  /** vscode://publisher.ext/authCallback style URI (VS Code only). */
  callback?: string;
  /** Loopback port the extension listens on (CLI / JetBrains). */
  port?: number;
  /**
   * An opaque random nonce the extension generates and verifies on callback.
   * Prevents an attacker who guesses the loopback port from injecting a token.
   */
  state?: string;
}
