/**
 * @ai-firewall/scanner
 *
 * Pure-function security scanners for secrets, PII, entropy, prompt injection,
 * and context-aware severity adjustment.
 *
 * All functions are stateless with zero side effects — safe to use in any context
 * (proxy routes, MCP servers, CLI tools, tests).
 *
 * Design:
 * - SRP: Each scanner has a single detection responsibility
 * - OCP: New patterns added via patterns.ts without changing scanner logic
 * - ISP: Consumers import only the scanners they need
 * - DIP: All functions depend on types, not concrete implementations
 */

// Types
export type {
  Severity,
  SecretType,
  PiiType,
  SecretMatch,
  PiiMatch,
  SecretScanResult,
  PiiScanResult,
  PromptInjectionMatch,
  PromptInjectionResult,
  ContextAdjustment,
  ScanPipelineResult,
} from "./types";

// Patterns (for consumers that need to inspect or extend)
export { secretPatterns, piiPatterns } from "./patterns";
export type { SecretPattern, PiiPattern } from "./patterns";

// Scanners
export { scanSecrets } from "./secretScanner";
export { scanPII } from "./piiScanner";
export { scanEntropy } from "./entropyScanner";
export { scanPromptInjection } from "./promptInjectionScanner";
export { adjustSeverity } from "./contextScanner";
