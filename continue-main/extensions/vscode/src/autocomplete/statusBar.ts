import { ILLM } from "core";
import { EXTENSION_NAME } from "core/control-plane/env";
import * as vscode from "vscode";

import { Battery } from "../util/battery";
import { getMetaKeyLabel } from "../util/util";
import {
  CONTINUE_WORKSPACE_KEY,
  getContinueWorkspaceConfig,
} from "../util/workspaceConfig";

export enum StatusBarStatus {
  Disabled,
  Enabled,
  Paused,
}

export const quickPickStatusText = (status: StatusBarStatus | undefined) => {
  switch (status) {
    case undefined:
    case StatusBarStatus.Disabled:
      return "$(circle-slash) Disable autocomplete";
    case StatusBarStatus.Enabled:
      return "$(check) Enable autocomplete";
    case StatusBarStatus.Paused:
      return "$(debug-pause) Pause autocomplete";
  }
};

export const getStatusBarStatusFromQuickPickItemLabel = (
  label: string,
): StatusBarStatus | undefined => {
  switch (label) {
    case "$(circle-slash) Disable autocomplete":
      return StatusBarStatus.Disabled;
    case "$(check) Enable autocomplete":
      return StatusBarStatus.Enabled;
    case "$(debug-pause) Pause autocomplete":
      return StatusBarStatus.Paused;
    default:
      return undefined;
  }
};

const statusBarItemText = (
  status: StatusBarStatus | undefined,
  loading?: boolean,
  error?: boolean,
) => {
  if (error) {
    return "$(alert) AI Firewall (config error)";
  }

  let text: string;
  switch (status) {
    case undefined:
      if (loading) {
        text = "$(loading~spin) AI Firewall";
      } else {
        text = "AI Firewall";
      }
      break;
    case StatusBarStatus.Disabled:
      text = "$(circle-slash) AI Firewall";
      break;
    case StatusBarStatus.Enabled:
      text = "$(check) AI Firewall";
      break;
    case StatusBarStatus.Paused:
      text = "$(debug-pause) AI Firewall";
      break;
    default:
      text = "AI Firewall";
  }

  // Append Next Edit indicator if enabled.
  const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
  const nextEditEnabled = config.get<boolean>("enableNextEdit") ?? false;
  if (nextEditEnabled) {
    text += " (NE)";
  }

  return text;
};

const statusBarItemTooltip = (status: StatusBarStatus | undefined) => {
  switch (status) {
    case undefined:
    case StatusBarStatus.Disabled:
      return "Click to enable tab autocomplete";
    case StatusBarStatus.Enabled:
      const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
      const nextEditEnabled = config.get<boolean>("enableNextEdit") ?? false;
      return nextEditEnabled
        ? "Next Edit is enabled"
        : "Tab autocomplete is enabled";
    case StatusBarStatus.Paused:
      return "Tab autocomplete is paused";
  }
};

let statusBarStatus: StatusBarStatus | undefined = undefined;
let statusBarItem: vscode.StatusBarItem | undefined = undefined;
let statusBarFalseTimeout: NodeJS.Timeout | undefined = undefined;
let statusBarError: boolean = false;

export function stopStatusBarLoading() {
  statusBarFalseTimeout = setTimeout(() => {
    setupStatusBar(StatusBarStatus.Enabled, false);
  }, 100);
}

/**
 * TODO: We should clean up how status bar is handled.
 * Ideally, there should be a single 'status' value without
 * 'loading' and 'error' booleans.
 */
export function setupStatusBar(
  status: StatusBarStatus | undefined,
  loading?: boolean,
  error?: boolean,
) {
  if (loading !== false) {
    clearTimeout(statusBarFalseTimeout);
    statusBarFalseTimeout = undefined;
  }

  // If statusBarItem hasn't been defined yet, create it
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
    );
  }

  if (error !== undefined) {
    statusBarError = error;

    if (status === undefined) {
      status = statusBarStatus;
    }

    if (loading === undefined) {
      loading = loading;
    }
  }

  statusBarItem.text = statusBarItemText(status, loading, statusBarError);
  statusBarItem.tooltip = statusBarItemTooltip(status ?? statusBarStatus);
  statusBarItem.command = "aiFirewall.openTabAutocompleteConfigMenu";

  statusBarItem.show();
  if (status !== undefined) {
    statusBarStatus = status;
  }

  vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(CONTINUE_WORKSPACE_KEY)) {
      const enabled = getContinueWorkspaceConfig().get<boolean>(
        "enableTabAutocomplete",
      );
      if (enabled && statusBarStatus === StatusBarStatus.Paused) {
        return;
      }
      setupStatusBar(
        enabled ? StatusBarStatus.Enabled : StatusBarStatus.Disabled,
      );
    }
  });
}

export function getStatusBarStatus(): StatusBarStatus | undefined {
  return statusBarStatus;
}

export function monitorBatteryChanges(battery: Battery): vscode.Disposable {
  return battery.onChangeAC((acConnected: boolean) => {
    const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
    const enabled = config.get<boolean>("enableTabAutocomplete");
    if (!!enabled) {
      const pauseOnBattery = config.get<boolean>(
        "pauseTabAutocompleteOnBattery",
      );
      setupStatusBar(
        acConnected || !pauseOnBattery
          ? StatusBarStatus.Enabled
          : StatusBarStatus.Paused,
      );
    }
  });
}

export function getAutocompleteStatusBarDescription(
  selected: string | undefined,
  { title, apiKey, providerName }: ILLM,
): string | undefined {
  if (title !== selected) {
    return undefined;
  }

  let description = "Current autocomplete model";

  // Only set for Mistral since our default config includes Codestral without
  // an API key
  if ((apiKey === undefined || apiKey === "") && providerName === "mistral") {
    description += " (Missing API key)";
  }

  return description;
}

export function getAutocompleteStatusBarTitle(
  selected: string | undefined,
  { title }: ILLM,
): string {
  if (!title) {
    return "Unnamed Model";
  }

  if (title === selected) {
    return `$(check) ${title}`;
  }

  return title;
}

const USE_FIM_MENU_ITEM_LABEL = "$(export) Use FIM autocomplete over Next Edit";
const USE_NEXT_EDIT_MENU_ITEM_LABEL =
  "$(sparkle) Use Next Edit over FIM autocomplete";

// Shows what items get rendered in the autocomplete menu.
export function getNextEditMenuItems(
  currentStatus: StatusBarStatus | undefined,
  nextEditEnabled: boolean,
): vscode.QuickPickItem[] {
  if (currentStatus !== StatusBarStatus.Enabled) return [];

  return [
    {
      label: nextEditEnabled
        ? USE_FIM_MENU_ITEM_LABEL
        : USE_NEXT_EDIT_MENU_ITEM_LABEL,
      description: getMetaKeyLabel() + " + K, " + getMetaKeyLabel() + " + N",
    },
  ];
}

// Checks if the current selected option is a Next Edit toggle label.
export function isNextEditToggleLabel(label: string): boolean {
  return (
    label === USE_FIM_MENU_ITEM_LABEL || label === USE_NEXT_EDIT_MENU_ITEM_LABEL
  );
}

// Updates the config once Next Edit is toggled.
export function handleNextEditToggle(
  label: string,
  config: vscode.WorkspaceConfiguration,
) {
  const isEnabling = label === USE_NEXT_EDIT_MENU_ITEM_LABEL;

  config.update(
    "enableNextEdit",
    isEnabling,
    vscode.ConfigurationTarget.Global,
  );
}

// --- AI Firewall Security Status ---

let scanFlashTimeout: ReturnType<typeof setTimeout> | undefined;

/**
 * Temporarily flash the status bar with scan results (action, tokens, cost).
 * Resets back to normal after 5 seconds.
 */
export function updateStatusBarAfterScan(meta: {
  action: string;
  model?: string;
  tokensUsed?: number;
  cost?: number;
  secretsCount?: number;
  piiCount?: number;
  riskScore?: number;
  redactedTypes?: string[];
}): void {
  if (!statusBarItem) {
    return;
  }

  if (scanFlashTimeout) {
    clearTimeout(scanFlashTimeout);
  }

  const modelStr = meta.model ? ` ${meta.model}` : "";
  const tokenStr =
    meta.tokensUsed !== undefined
      ? ` | ${(meta.tokensUsed / 1000).toFixed(1)}k tok`
      : "";
  const costStr =
    meta.cost !== undefined ? ` | $${meta.cost.toFixed(4)}` : "";

  statusBarItem.text = `$(shield)${modelStr}${tokenStr}${costStr}`;

  if (meta.action === "BLOCK") {
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground",
    );
  } else if (meta.action === "REDACT") {
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground",
    );
  } else {
    statusBarItem.backgroundColor = undefined;
  }

  // Show VS Code toast notification for BLOCK and REDACT
  showScanNotification(meta);

  // Reset after 5 seconds
  scanFlashTimeout = setTimeout(() => {
    if (statusBarItem) {
      statusBarItem.backgroundColor = undefined;
      setupStatusBar(statusBarStatus);
    }
  }, 5000);
}

/**
 * Show a VS Code toast notification (bottom-right) for BLOCK/REDACT actions.
 * ALLOW is silent — only alert the user when something was caught.
 */
function showScanNotification(meta: {
  action: string;
  secretsCount?: number;
  piiCount?: number;
  riskScore?: number;
  redactedTypes?: string[];
}): void {
  if (meta.action === "ALLOW") return; // Silent for clean requests

  const findings: string[] = [];
  if (meta.secretsCount && meta.secretsCount > 0) {
    findings.push(`${meta.secretsCount} secret${meta.secretsCount > 1 ? "s" : ""}`);
  }
  if (meta.piiCount && meta.piiCount > 0) {
    findings.push(`${meta.piiCount} PII item${meta.piiCount > 1 ? "s" : ""}`);
  }
  if (meta.redactedTypes && meta.redactedTypes.length > 0) {
    findings.push(meta.redactedTypes.join(", "));
  }

  const riskStr = meta.riskScore !== undefined ? ` (Risk: ${meta.riskScore}/100)` : "";
  const detailStr = findings.length > 0 ? `: ${findings.join(" · ")}` : "";

  if (meta.action === "BLOCK") {
    vscode.window
      .showErrorMessage(
        `AI Firewall: Request BLOCKED${riskStr}${detailStr}`,
        "View Details",
        "Open Policy",
      )
      .then((selection) => {
        if (selection === "View Details") {
          vscode.commands.executeCommand("aiFirewall.viewLogs");
        } else if (selection === "Open Policy") {
          vscode.commands.executeCommand("aiFirewall.openPolicy");
        }
      });
  } else if (meta.action === "REDACT") {
    vscode.window
      .showWarningMessage(
        `AI Firewall: Sensitive data REDACTED${riskStr}${detailStr}`,
        "View Details",
      )
      .then((selection) => {
        if (selection === "View Details") {
          vscode.commands.executeCommand("aiFirewall.viewLogs");
        }
      });
  } else if (meta.action === "REQUIRE_APPROVAL") {
    vscode.window
      .showInformationMessage(
        `AI Firewall: Action requires approval${riskStr}`,
        "Approve",
        "Deny",
      )
      .then((selection) => {
        if (selection === "Approve") {
          vscode.commands.executeCommand("aiFirewall.approveAction");
        } else if (selection === "Deny") {
          vscode.commands.executeCommand("aiFirewall.denyAction");
        }
      });
  }
}

/**
 * Update status bar to show proxy health state.
 */
export function updateStatusBarHealth(healthy: boolean): void {
  if (!statusBarItem) {
    return;
  }
  if (!healthy) {
    statusBarItem.text = "$(shield) AI Firewall: offline";
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.errorBackground",
    );
  }
}
