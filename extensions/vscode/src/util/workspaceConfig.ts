import { workspace } from "vscode";

export const AI_FIREWALL_WORKSPACE_KEY = "aiFirewall";

export function getAiFirewallWorkspaceConfig() {
  return workspace.getConfiguration(AI_FIREWALL_WORKSPACE_KEY);
}
