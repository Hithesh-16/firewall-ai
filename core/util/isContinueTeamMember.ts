/**
 * Utility to check if a user is an AI Firewall team member
 */
export function isFirewallTeamMember(email?: string): boolean {
  if (!email) return false;
  return email.endsWith("@ai-firewall.dev");
}

/**
 * @deprecated Use isFirewallTeamMember instead
 */
export const isContinueTeamMember = isFirewallTeamMember;
