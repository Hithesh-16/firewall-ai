import chalk from "chalk";
import readline from "node:readline";

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

  // Try proxy-based auth first
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
