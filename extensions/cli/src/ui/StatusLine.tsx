import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { Box, Text } from "ink";
import React, { useEffect, useRef, useState } from "react";

import { loadCliSettings, type StatusLineSettings } from "../util/settings.js";

/**
 * User-configurable status line rendered between the chat history and
 * the input. Mirrors Claude Code's statusline: reads
 * `~/.ai-firewall/settings.json`, and if `statusLine.type === "command"`
 * runs the configured shell script on an interval and renders its
 * first stdout line.
 *
 * When no script is configured (default) we render a built-in line with
 * host, cwd, model, and context usage. If the script errors or times
 * out we silently fall back to the default so the chat UX doesn't
 * degrade into error text.
 */

export interface StatusLineContext {
  model?: string;
  cwd: string;
  sessionId?: string;
  contextPercentage?: number;
  totalCost: number;
}

const DEFAULT_INTERVAL_MS = 2000;
const SCRIPT_TIMEOUT_MS = 1500;
const MAX_OUTPUT_CHARS = 500;

export const StatusLine: React.FC<{ ctx: StatusLineContext }> = ({ ctx }) => {
  const [settings, setSettings] = useState<StatusLineSettings | undefined>(
    () => loadCliSettings().statusLine,
  );
  const [scriptOutput, setScriptOutput] = useState<string | null>(null);

  // Re-read settings every 5s so edits via /statusline pick up without
  // a TUI restart. Cheap — just one small JSON read.
  useEffect(() => {
    const id = setInterval(() => {
      setSettings(loadCliSettings().statusLine);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // Spawn the script on an interval when command mode is active.
  const latestCtx = useRef(ctx);
  latestCtx.current = ctx;

  useEffect(() => {
    if (
      !settings ||
      settings.type !== "command" ||
      settings.enabled === false
    ) {
      setScriptOutput(null);
      return;
    }
    const interval = settings.updateIntervalMs ?? DEFAULT_INTERVAL_MS;

    let cancelled = false;
    const run = () => {
      const scriptContext = {
        model: latestCtx.current.model ?? "",
        cwd: latestCtx.current.cwd,
        sessionId: latestCtx.current.sessionId ?? "",
        contextPercentage: latestCtx.current.contextPercentage ?? 0,
        totalCost: latestCtx.current.totalCost,
        user: os.userInfo().username,
        hostname: os.hostname().split(".")[0],
      };
      const child = spawn(settings.command, [], {
        shell: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, SCRIPT_TIMEOUT_MS);
      let stdout = "";
      child.stdout?.on("data", (d) => {
        stdout += d.toString();
        if (stdout.length > MAX_OUTPUT_CHARS) {
          child.kill("SIGKILL");
        }
      });
      child.on("close", () => {
        clearTimeout(timeout);
        if (cancelled) return;
        const firstLine = stdout
          .split("\n")[0]
          .trim()
          .slice(0, MAX_OUTPUT_CHARS);
        setScriptOutput(firstLine || null);
      });
      child.on("error", () => {
        clearTimeout(timeout);
        if (!cancelled) setScriptOutput(null);
      });
      try {
        child.stdin?.write(JSON.stringify(scriptContext));
        child.stdin?.end();
      } catch {
        /* child already exited */
      }
    };

    run();
    const id = setInterval(run, interval);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [settings]);

  if (settings?.enabled === false) return null;

  // Command mode with output → render it verbatim.
  if (settings?.type === "command" && scriptOutput) {
    return (
      <Box paddingX={1}>
        <Text dimColor>{scriptOutput}</Text>
      </Box>
    );
  }

  // Default / fallback statusline.
  const cwdLabel = abbreviateHomeDir(ctx.cwd);
  const model = ctx.model ?? "no-model";
  const ctxPct =
    typeof ctx.contextPercentage === "number"
      ? `ctx:${Math.round(ctx.contextPercentage)}%`
      : null;
  const cost =
    ctx.totalCost > 0
      ? `$${ctx.totalCost.toFixed(ctx.totalCost < 0.01 ? 4 : 2)}`
      : null;
  const host = `${os.userInfo().username}@${os.hostname().split(".")[0]}`;

  return (
    <Box paddingX={1}>
      <Text dimColor>
        <Text color="green">{host}</Text>
        {":"}
        <Text color="blue">{cwdLabel}</Text>{" "}
        <Text color="yellow">[{model}]</Text>
        {ctxPct ? <Text color="cyan">{" " + ctxPct}</Text> : null}
        {cost ? <Text color="magenta">{" " + cost}</Text> : null}
      </Text>
    </Box>
  );
};

function abbreviateHomeDir(cwd: string): string {
  const home = os.homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(home + path.sep)) {
    return "~" + cwd.slice(home.length);
  }
  return cwd;
}
