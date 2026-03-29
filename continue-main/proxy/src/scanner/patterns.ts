/**
 * Re-export from @ai-firewall/scanner shared package.
 * Backward-compatible: all existing proxy imports continue working.
 */
export { secretPatterns, piiPatterns } from "@ai-firewall/scanner";
export type { SecretPattern, PiiPattern } from "@ai-firewall/scanner";
