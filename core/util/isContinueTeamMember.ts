/**
 * Utility to check if a user is an AI Firewall team member.
 *
 * Filename retained for import-path stability — see the matching
 * `gui/src/util/isContinueTeamMember.ts` for context. Phase H.H7a
 * removed the deprecated `isContinueTeamMember` alias.
 */
export function isFirewallTeamMember(email?: string): boolean {
  if (!email) return false;
  return email.endsWith("@ai-firewall.dev");
}
