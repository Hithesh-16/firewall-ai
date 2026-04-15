import { ChildProcess, spawn } from "child_process";
import os from "os";
import path from "path";
import * as vscode from "vscode";

const DEFAULT_PORT = 8080;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const STARTUP_TIMEOUT_MS = 10_000;
const HEALTH_POLL_MS = 300;
const LOG_FILE = path.join(os.homedir(), ".ai-firewall", "logs", "proxy.log");

export class ProxyManager {
  private process: ChildProcess | null = null;
  private port: number;
  private healthy = false;
  private healthInterval: NodeJS.Timeout | null = null;
  private outputChannel: vscode.OutputChannel;

  constructor(private extensionPath: string) {
    this.port = vscode.workspace
      .getConfiguration("aiFirewall")
      .get<number>("proxyPort", DEFAULT_PORT);
    this.outputChannel = vscode.window.createOutputChannel("AI Firewall Proxy");
  }

  get proxyUrl(): string {
    return `http://localhost:${this.port}`;
  }

  get apiBase(): string {
    return `${this.proxyUrl}/v1/`;
  }

  get isHealthy(): boolean {
    return this.healthy;
  }

  /**
   * Resolve path to the proxy dist/server.js.
   * In dev: ../../proxy/dist/server.js (relative to extensions/vscode)
   * In packaged VSIX: the proxy is bundled alongside
   */
  private getServerPath(): { resolved: string; candidates: string[] } {
    // Try multiple candidate locations
    const workspaceRoot =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    const candidates = [
      // Development: repo root (extension is in extensions/vscode/)
      path.resolve(
        this.extensionPath,
        "..",
        "..",
        "proxy",
        "dist",
        "server.js",
      ),
      // Packaged: proxy bundled inside extension
      path.resolve(this.extensionPath, "proxy", "dist", "server.js"),
      // Alternative: out/ directory
      path.resolve(this.extensionPath, "out", "proxy", "server.js"),
      // Workspace: proxy lives alongside in the monorepo the user opened
      ...(workspaceRoot
        ? [
            path.resolve(workspaceRoot, "proxy", "dist", "server.js"),
            path.resolve(workspaceRoot, "..", "proxy", "dist", "server.js"),
          ]
        : []),
      // Global fallback: well-known install location
      path.resolve(
        process.env.HOME ?? "",
        ".ai-firewall",
        "proxy",
        "dist",
        "server.js",
      ),
    ];

    const fs = require("fs");
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return { resolved: candidate, candidates };
      }
    }

    // Default to dev path
    return { resolved: candidates[0], candidates };
  }

  async start(): Promise<boolean> {
    if (this.process) {
      this.outputChannel.appendLine("[ProxyManager] Proxy already running");
      return true;
    }

    // Check if something is already running on the port
    if (await this.checkHealth()) {
      this.outputChannel.appendLine(
        `[ProxyManager] Proxy already running on port ${this.port}`,
      );
      this.healthy = true;
      this.startHealthCheck();
      return true;
    }

    const { resolved: serverPath, candidates } = this.getServerPath();
    this.outputChannel.appendLine(
      `[ProxyManager] Starting proxy: node ${serverPath}`,
    );

    const fs = require("fs");
    if (!fs.existsSync(serverPath)) {
      this.outputChannel.appendLine(
        `[ProxyManager] WARNING: server.js not found. Tried:\n${candidates.map((c: string) => `  - ${c}`).join("\n")}`,
      );
      this.outputChannel.appendLine(
        `[ProxyManager] Run 'cd proxy && npm run build' to compile the proxy.`,
      );
      vscode.window
        .showWarningMessage(
          `AI Firewall proxy not found. Security scanning disabled.`,
          "Build Proxy",
          "Open Output",
        )
        .then((choice) => {
          if (choice === "Build Proxy") {
            const terminal = vscode.window.createTerminal("AI Firewall Build");
            terminal.show();
            terminal.sendText(
              `cd "${path.resolve(this.extensionPath, "..", "..", "proxy")}" && npm run build && node dist/server.js`,
            );
          } else if (choice === "Open Output") {
            this.outputChannel.show();
          }
        });
      return false;
    }

    try {
      const consoleLogLevel = vscode.workspace
        .getConfiguration("aiFirewall")
        .get<string>("proxyLogLevel", "info");

      this.process = spawn("node", [serverPath], {
        env: {
          ...process.env,
          PORT: String(this.port),
          NODE_ENV: "production",
          LOG_LEVEL: consoleLogLevel,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });

      this.outputChannel.appendLine(
        `[ProxyManager] Full trace log -> ${LOG_FILE}`,
      );
      this.outputChannel.appendLine(
        `[ProxyManager] Console level: ${consoleLogLevel} (override via aiFirewall.proxyLogLevel)`,
      );

      this.process.stdout?.on("data", (data: Buffer) => {
        const msg = data.toString().trim();
        if (!msg) return;
        this.outputChannel.appendLine(`[proxy] ${msg}`);
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        const msg = data.toString().trim();
        if (!msg) return;
        this.outputChannel.appendLine(`[proxy:err] ${msg}`);
      });

      this.process.on("exit", (code) => {
        this.outputChannel.appendLine(
          `[ProxyManager] Proxy exited with code ${code}`,
        );
        this.process = null;
        this.healthy = false;
      });

      this.process.on("error", (err) => {
        this.outputChannel.appendLine(
          `[ProxyManager] Failed to start proxy: ${err.message}`,
        );
        this.process = null;
        this.healthy = false;
      });

      // Wait for health check
      const started = await this.waitForHealthy(STARTUP_TIMEOUT_MS);
      if (started) {
        this.outputChannel.appendLine(
          `[ProxyManager] Proxy started on port ${this.port}`,
        );
        this.startHealthCheck();
      } else {
        this.outputChannel.appendLine(
          `[ProxyManager] Proxy failed to become healthy within ${STARTUP_TIMEOUT_MS}ms`,
        );
        this.stop();
      }

      return started;
    } catch (err: any) {
      this.outputChannel.appendLine(
        `[ProxyManager] Error starting proxy: ${err.message}`,
      );
      return false;
    }
  }

  stop(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }

    if (this.process) {
      this.outputChannel.appendLine("[ProxyManager] Stopping proxy");
      this.process.kill("SIGTERM");
      this.process = null;
    }

    this.healthy = false;
  }

  private async checkHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.proxyUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        this.healthy = true;
        return true;
      }
    } catch {
      // Not running
    }
    this.healthy = false;
    return false;
  }

  private async waitForHealthy(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.checkHealth()) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
    }
    return false;
  }

  private startHealthCheck(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
    }
    this.healthInterval = setInterval(async () => {
      const wasHealthy = this.healthy;
      await this.checkHealth();
      if (wasHealthy && !this.healthy) {
        this.outputChannel.appendLine("[ProxyManager] Proxy became unhealthy");
      } else if (!wasHealthy && this.healthy) {
        this.outputChannel.appendLine("[ProxyManager] Proxy recovered");
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  dispose(): void {
    this.stop();
    this.outputChannel.dispose();
  }
}
