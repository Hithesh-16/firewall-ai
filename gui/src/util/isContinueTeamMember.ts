/**
 * Utility to check if a user is an AI Firewall team member.
 *
 * NOTE on filename: this file is still named `isContinueTeamMember.ts`
 * for import-path stability — every caller currently imports from
 * `"../util/isContinueTeamMember"`. Renaming the file would touch
 * every call site for zero runtime benefit; the deprecated alias
 * has been removed (Phase H.H7a) and a follow-up PR can swap the
 * file name when there's a reason to touch those imports anyway.
 */
export function isFirewallTeamMember(email?: string): boolean {
  if (!email) return false;
  return email.includes("@ai-firewall.dev");
}
