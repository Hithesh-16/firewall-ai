import { ProfileDescription } from "core/config/ProfileLifecycleManager";
import { KeyboardEvent as ReactKeyboardEvent } from "react";
import { getLocalStorage } from "./localStorage";

export type Platform = "mac" | "linux" | "windows" | "unknown";

export function getPlatform(): Platform {
  const platform = window.navigator.platform.toUpperCase();
  if (platform.indexOf("MAC") >= 0) {
    return "mac";
  } else if (platform.indexOf("LINUX") >= 0) {
    return "linux";
  } else if (platform.indexOf("WIN") >= 0) {
    return "windows";
  } else {
    return "unknown";
  }
}

export function isMetaEquivalentKeyPressed({
  metaKey,
  ctrlKey,
}: KeyboardEvent | ReactKeyboardEvent): boolean {
  const platform = getPlatform();
  switch (platform) {
    case "mac":
      return metaKey;
    case "linux":
    case "windows":
      return ctrlKey;
    default:
      return metaKey;
  }
}

export function getMetaKeyLabel(): string {
  return getPlatform() === "mac" ? "⌘" : "Ctrl";
}

export function getAltKeyLabel(): string {
  const platform = getPlatform();
  switch (platform) {
    case "mac":
      return "⌥";
    default:
      return "Alt";
  }
}

export function getFontSize(): number {
  return getLocalStorage("fontSize") ?? (isJetBrains() ? 15 : 14);
}

export function fontSize(n: number): string {
  return `${getFontSize() + n}px`;
}

export function isJetBrains() {
  return getLocalStorage("ide") === "jetbrains";
}

export function isVscode() {
  return getLocalStorage("ide") === "vscode";
}

/**
 * Returns true when running inside any IDE (VS Code or JetBrains).
 * Admin pages (RBAC, Org, Team, Security) should be hidden in IDE mode.
 */
export function isInIde(): boolean {
  const ide = getLocalStorage("ide");
  return ide === "vscode" || ide === "jetbrains";
}

/**
 * The `gui/` app is now IDE-only — admin/dashboard usage lives in the
 * separate `web/` Vite app on port 5174. This helper used to return true
 * outside the IDE (and surfaced a `WebNavSidebar` with every page), but
 * we no longer want users to reach the IDE chat UI from a plain browser.
 * Always return false so the standalone-web layout branch is dead code.
 */
export function isStandaloneWeb(): boolean {
  return false;
}

export const isShareSessionSupported = () => !isJetBrains();

export function isWebEnvironment(): boolean {
  return (
    typeof window !== "undefined" &&
    window.navigator &&
    window.navigator.userAgent.indexOf("Electron") === -1
  );
}

export function isPrerelease() {
  const extensionVersion = getLocalStorage("extensionVersion");
  if (!extensionVersion) {
    console.warn(
      `Could not find extension version in local storage, assuming it's a prerelease`,
    );
    return true;
  }
  const minor = parseInt(extensionVersion.split(".")[1], 10);
  if (minor % 2 !== 0) {
    return true;
  }
  return false;
}

export function isLocalProfile(profile: ProfileDescription): boolean {
  return profile.profileType === "local";
}
