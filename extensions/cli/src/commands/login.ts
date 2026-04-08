import chalk from "chalk";
import readline from "node:readline";
import http from "node:http";

import { login as workosLogin, saveAuthConfig } from "../auth/workos.js";
import { gracefulExit } from "../util/exit.js";

import { chat } from "./chat.js";

const PROXY_BASE = process.env.AI_FIREWALL_PROXY_URL || "http://localhost:8080";

function prompt(question: string, isPassword = false): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (isPassword && process.stdin.isTTY) {
      // Mask password input
      process.stdout.write(question);
      let input = "";
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      const onData = (char: string) => {
        if (char === "\n" || char === "\r" || char === "\u0004") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.close();
          resolve(input);
        } else if (char === "\u0003") {
          // Ctrl+C
          process.stdin.setRawMode(false);
          rl.close();
          process.exit(0);
        } else if (char === "\u007F" || char === "\b") {
          // Backspace
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else {
          input += char;
          process.stdout.write("*");
        }
      };
      process.stdin.on("data", onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

/**
 * Start a temporary local HTTP server to receive the OAuth callback token.
 * Returns a promise that resolves with the token string.
 */
function waitForOAuthCallback(
  port: number,
  timeoutMs = 120_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      const token = url.searchParams.get("token");

      if (token) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0;">
            <div style="text-align:center;">
              <h2>Authenticated!</h2>
              <p>You can close this window and return to the terminal.</p>
            </div>
          </body></html>
        `);
        server.close();
        resolve(token);
      } else {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing token parameter");
      }
    });

    server.listen(port, "127.0.0.1");

    const timer = setTimeout(() => {
      server.close();
      reject(new Error("OAuth callback timed out"));
    }, timeoutMs);

    server.on("close", () => clearTimeout(timer));
    server.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Authenticate via Google OAuth through the proxy SSO flow.
 * Opens the browser, starts a local callback server, and waits for the token.
 */
async function authenticateWithGoogle(): Promise<boolean> {
  const callbackPort = 19836;

  console.info(chalk.dim("\nOpening browser for Google sign-in..."));

  // Start the local callback server before opening the browser
  const tokenPromise = waitForOAuthCallback(callbackPort);

  // Open the proxy SSO login URL — the proxy will redirect to Google
  // After Google auth, the proxy callback HTML will post the token.
  // We use a custom redirect that sends the token to our local server.
  try {
    const open = (await import("open")).default;
    await open(`${PROXY_BASE}/api/auth/sso/login?provider=google`);
  } catch {
    console.info(
      chalk.yellow(
        `Could not open browser. Please visit: ${PROXY_BASE}/api/auth/sso/login?provider=google`,
      ),
    );
  }

  console.info(chalk.dim("Waiting for authentication in browser..."));

  try {
    const token = await tokenPromise;

    // Verify the token and get user info
    const meRes = await fetch(`${PROXY_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!meRes.ok) {
      console.error(chalk.red("Failed to verify token from OAuth flow."));
      return false;
    }

    const meData = (await meRes.json()) as {
      user: { id: number; email: string; name: string; role: string };
    };

    saveAuthConfig({
      userId: String(meData.user.id),
      userEmail: meData.user.email,
      accessToken: token,
      refreshToken: "",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      organizationId: null,
    });

    console.info(
      chalk.green(`\nLogged in as ${meData.user.email} (${meData.user.role})`),
    );
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Google OAuth failed: ${msg}`));
    return false;
  }
}

/**
 * Authenticate against the proxy (or WorkOS fallback).
 * Returns true if auth succeeded, false if the user aborted.
 * Does NOT start chat — callers decide what to do next.
 */
export async function authenticate(): Promise<boolean> {
  console.info(chalk.yellow("AI Firewall — Login\n"));

  // Check for env var shortcut
  if (process.env.AI_FIREWALL_API_KEY) {
    console.info(chalk.green("Using AI_FIREWALL_API_KEY from environment."));
    return true;
  }

  // Check if proxy is reachable and has SSO configured
  let ssoProviders: string[] = [];
  try {
    const ssoRes = await fetch(`${PROXY_BASE}/api/auth/sso/config`);
    if (ssoRes.ok) {
      const ssoData = (await ssoRes.json()) as {
        enabled: boolean;
        providers: string[];
      };
      if (ssoData.enabled) {
        ssoProviders = ssoData.providers;
      }
    }
  } catch {
    // Proxy not reachable — will fall back below
  }

  // Show auth method selection if SSO is available
  if (ssoProviders.length > 0) {
    console.info(chalk.white("Choose sign-in method:\n"));
    console.info(chalk.white("  1) Email & Password"));
    if (ssoProviders.includes("google")) {
      console.info(chalk.white("  2) Google OAuth"));
    }
    if (ssoProviders.includes("github")) {
      console.info(chalk.white("  3) GitHub OAuth"));
    }
    console.info("");

    const choice = await prompt(chalk.white("Enter choice (1): "));
    const selected = choice.trim() || "1";

    if (selected === "2" && ssoProviders.includes("google")) {
      return authenticateWithGoogle();
    }
    if (selected === "3" && ssoProviders.includes("github")) {
      // GitHub uses the same OAuth flow pattern
      return authenticateWithSSO("github");
    }
    // Default: fall through to email/password
  }

  // Try proxy-based email/password auth
  try {
    const email = await prompt(chalk.white("Email: "));
    const password = await prompt(chalk.white("Password: "), true);

    if (!email || !password) {
      console.error(chalk.red("Email and password are required."));
      return false;
    }

    const res = await fetch(`${PROXY_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      const errMsg = (body as { error?: string }).error ?? `HTTP ${res.status}`;

      // If proxy is running but credentials are wrong
      if (res.status === 401 || res.status === 400) {
        console.error(chalk.red(`Login failed: ${errMsg}`));

        // Offer registration
        const register = await prompt(
          chalk.yellow("\nNo account? Register now? (y/n): "),
        );
        if (register.toLowerCase() === "y") {
          const name = await prompt(chalk.white("Name: "));
          const regRes = await fetch(`${PROXY_BASE}/api/auth/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, name, password }),
          });
          if (regRes.ok) {
            const data = (await regRes.json()) as {
              user: { id: string; email: string; name: string; role: string };
              token: string;
            };
            saveAuthConfig({
              userId: String(data.user.id),
              userEmail: data.user.email,
              accessToken: data.token,
              refreshToken: "",
              expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
              organizationId: null,
            });
            console.info(
              chalk.green(
                `\nRegistered and logged in as ${data.user.email} (${data.user.role})`,
              ),
            );
            return true;
          }
          const regBody = await regRes.json().catch(() => ({}));
          console.error(
            chalk.red(
              `Registration failed: ${(regBody as { error?: string }).error ?? regRes.statusText}`,
            ),
          );
          return false;
        }
        return false;
      }

      throw new Error(errMsg);
    }

    const data = (await res.json()) as {
      user: { id: string; email: string; name: string; role: string };
      token: string;
    };

    saveAuthConfig({
      userId: String(data.user.id),
      userEmail: data.user.email,
      accessToken: data.token,
      refreshToken: "",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      organizationId: null,
    });

    console.info(
      chalk.green(`\nLogged in as ${data.user.email} (${data.user.role})`),
    );
    return true;
  } catch (error: unknown) {
    const err = error as {
      code?: string;
      cause?: { code?: string };
      message?: string;
    };
    // If proxy is unreachable, fall back to WorkOS
    if (err.code === "ECONNREFUSED" || err.cause?.code === "ECONNREFUSED") {
      console.info(
        chalk.yellow(
          "\nProxy not running on localhost:8080. Falling back to legacy auth...",
        ),
      );
      try {
        await workosLogin();
        console.info(chalk.green("Successfully logged in!"));
        return true;
      } catch (fallbackErr: unknown) {
        const fbErr = fallbackErr as { message?: string };
        console.error(chalk.red(`Login failed: ${fbErr.message}`));
        return false;
      }
    }

    console.error(chalk.red(`Login failed: ${err.message}`));
    return false;
  }
}

/**
 * Authenticate via any SSO provider through the proxy.
 */
async function authenticateWithSSO(provider: string): Promise<boolean> {
  const callbackPort = 19836;

  console.info(chalk.dim(`\nOpening browser for ${provider} sign-in...`));

  const tokenPromise = waitForOAuthCallback(callbackPort);

  try {
    const open = (await import("open")).default;
    await open(`${PROXY_BASE}/api/auth/sso/login?provider=${provider}`);
  } catch {
    console.info(
      chalk.yellow(
        `Could not open browser. Please visit: ${PROXY_BASE}/api/auth/sso/login?provider=${provider}`,
      ),
    );
  }

  console.info(chalk.dim("Waiting for authentication in browser..."));

  try {
    const token = await tokenPromise;

    const meRes = await fetch(`${PROXY_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!meRes.ok) {
      console.error(chalk.red("Failed to verify token from OAuth flow."));
      return false;
    }

    const meData = (await meRes.json()) as {
      user: { id: number; email: string; name: string; role: string };
    };

    saveAuthConfig({
      userId: String(meData.user.id),
      userEmail: meData.user.email,
      accessToken: token,
      refreshToken: "",
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      organizationId: null,
    });

    console.info(
      chalk.green(`\nLogged in as ${meData.user.email} (${meData.user.role})`),
    );
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`${provider} OAuth failed: ${msg}`));
    return false;
  }
}

/**
 * Login command — authenticates and then starts chat.
 */
export async function login() {
  const success = await authenticate();
  if (success) {
    await chat();
  } else {
    await gracefulExit(1);
  }
}
