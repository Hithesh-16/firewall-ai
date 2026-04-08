import { EXTENSION_NAME } from "core/control-plane/env";
import * as vscode from "vscode";

export async function getUserToken(): Promise<string> {
  // 1. Prefer manual user token (set via settings or login command)
  const settings = vscode.workspace.getConfiguration(EXTENSION_NAME);
  const userToken = settings.get<string | null>("userToken", null);
  if (userToken) {
    return userToken;
  }

  // 2. Try proxy-based auth token from global state
  const globalState = getGlobalState();
  const proxyToken = globalState?.get<string>("aiFirewall.proxyToken");
  if (proxyToken) {
    return proxyToken;
  }

  // 3. Fall back to GitHub auth session
  const session = await vscode.authentication.getSession("github", [], {
    createIfNone: true,
  });
  return session.accessToken;
}

/** Store a proxy auth token for the current user */
export async function setProxyToken(token: string): Promise<void> {
  const settings = vscode.workspace.getConfiguration(EXTENSION_NAME);
  await settings.update("userToken", token, vscode.ConfigurationTarget.Global);
}

/** Clear the stored proxy auth token */
export async function clearProxyToken(): Promise<void> {
  const settings = vscode.workspace.getConfiguration(EXTENSION_NAME);
  await settings.update(
    "userToken",
    undefined,
    vscode.ConfigurationTarget.Global,
  );
}

/** Check if the user is authenticated with the proxy */
export async function isProxyAuthenticated(): Promise<boolean> {
  const settings = vscode.workspace.getConfiguration(EXTENSION_NAME);
  const token = settings.get<string | null>("userToken", null);
  if (!token) return false;

  try {
    const res = await fetch("http://localhost:8080/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Helper to access VS Code global state (set externally by extension activation)
let _globalState: vscode.Memento | undefined;
export function setGlobalState(state: vscode.Memento): void {
  _globalState = state;
}
function getGlobalState(): vscode.Memento | undefined {
  return _globalState;
}
