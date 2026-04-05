/**
 * TUI lifecycle and two-stage exit state management.
 *
 * Extracted from index.ts to break circular imports:
 *   index.ts -> chat.ts -> ui/index.ts -> index.ts
 *
 * Any module that needs these functions should import from here, not from index.ts.
 */

import { gracefulExit } from "./util/exit.js";

// TUI lifecycle and two-stage exit state management
let tuiUnmount: (() => void) | null = null;
let showExitMessage: boolean = false;
let exitMessageCallback: (() => void) | null = null;
let lastCtrlCTime: number = 0;

// Agent ID for serve mode - set when serve command is invoked with --id
let agentId: string | undefined;

// Set the agent ID for error reporting (called by serve command)
export function setAgentId(id: string | undefined) {
  agentId = id;
}

export function getAgentId(): string | undefined {
  return agentId;
}

// Register TUI cleanup function for graceful shutdown
export function setTUIUnmount(unmount: () => void) {
  tuiUnmount = unmount;
}

// Register callback to trigger UI updates when exit message state changes
export function setExitMessageCallback(callback: () => void) {
  exitMessageCallback = callback;
}

// Check if "ctrl+c to exit" message should be displayed
export function shouldShowExitMessage(): boolean {
  return showExitMessage;
}

// Sets up SIGINT handler that requires double Ctrl+C within 1 second to exit
export function enableSigintHandler() {
  // Remove all existing SIGINT listeners first
  process.removeAllListeners("SIGINT");

  process.on("SIGINT", async () => {
    const now = Date.now();
    const timeSinceLastCtrlC = now - lastCtrlCTime;

    if (timeSinceLastCtrlC <= 1000 && lastCtrlCTime !== 0) {
      // Second Ctrl+C within 1 second - exit
      showExitMessage = false;
      if (tuiUnmount) {
        tuiUnmount();
      }
      await gracefulExit(0);
    } else {
      // First Ctrl+C or too much time elapsed - show exit message
      lastCtrlCTime = now;
      showExitMessage = true;
      if (exitMessageCallback) {
        exitMessageCallback();
      }

      // Hide message after 1 second
      setTimeout(() => {
        showExitMessage = false;
        if (exitMessageCallback) {
          exitMessageCallback();
        }
      }, 1000);
    }
  });
}
