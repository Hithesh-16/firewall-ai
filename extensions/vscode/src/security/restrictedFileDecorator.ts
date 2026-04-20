/**
 * Restricted File Decorator — VS Code Explorer badge
 *
 * Registers a FileDecorationProvider that marks files restricted by
 * the AI Firewall policy with a shield badge and red foreground color
 * in the Explorer view. Hovering the file shows which pattern blocks it.
 *
 * Data source: the in-memory file scope loaded by fileRestrictionChecker.ts.
 * Refreshes whenever policy or auth state changes.
 */

import * as vscode from "vscode";
import {
  getRestrictionReason,
  isFileRestricted,
} from "./fileRestrictionChecker";

class RestrictedFileDecorationProvider
  implements vscode.FileDecorationProvider
{
  private readonly emitter = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >();
  readonly onDidChangeFileDecorations = this.emitter.event;

  provideFileDecoration(
    uri: vscode.Uri,
  ): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme !== "file") return undefined;

    const workspace = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspace) return undefined;

    // Convert to a workspace-relative path so blocklist globs
    // like ".env" and "**/*.pem" evaluate against the same shape
    // the proxy uses.
    const relativePath = vscode.workspace
      .asRelativePath(uri, false)
      .replace(/\\/g, "/");

    if (!isFileRestricted(relativePath)) return undefined;

    const reason = getRestrictionReason(relativePath) ?? "Restricted by policy";

    return {
      // U+26E8 BLACK CROSS ON SHIELD — renders as a crisp monochrome
      // shield that takes on the theme color, matching the AI Firewall
      // extension's sidebar shield icon. Single char so the filename
      // stays fully visible.
      badge: "🔒",
      tooltip: `AI Firewall: ${reason}`,
      // charts.green is the standard theme-aware green that follows
      // the user's theme. Matches the emerald brand accent of the
      // AI Firewall extension icon. VS Code applies this to the badge;
      // on the filename it renders as a very subtle tint, matching
      // how Git decorations colour modified/new files.
      color: new vscode.ThemeColor("charts.green"),
      propagate: true,
    };
  }

  /**
   * Force VS Code to re-query decorations for every currently
   * visible file. Call after policy refresh / auth change.
   */
  refresh(): void {
    this.emitter.fire(undefined);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

let providerInstance: RestrictedFileDecorationProvider | undefined;

/**
 * Register the file decorator with VS Code. Returns a disposable
 * the extension should push onto its context subscriptions.
 */
export function registerRestrictedFileDecorator(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  providerInstance = new RestrictedFileDecorationProvider();
  const disposable =
    vscode.window.registerFileDecorationProvider(providerInstance);
  context.subscriptions.push(disposable);
  context.subscriptions.push(providerInstance);
  return disposable;
}

/**
 * Re-render all file decorations. Call after file scope policy is
 * refreshed so newly blocked files update without a window reload.
 */
export function refreshRestrictedFileDecorations(): void {
  providerInstance?.refresh();
}
