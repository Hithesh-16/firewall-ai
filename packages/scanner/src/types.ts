/**
 * Scanner Types
 *
 * Extracted from proxy/src/types/index.ts — scanner-specific types only.
 * Interface Segregation: consumers of scanners don't need policy/auth/gateway types.
 */

export type Severity = "critical" | "high" | "medium";

export type SecretType =
  | "AWS_KEY"
  | "PRIVATE_KEY"
  | "JWT"
  | "BEARER_TOKEN"
  | "GENERIC_API_KEY"
  | "DATABASE_URL"
  | "GITHUB_TOKEN"
  | "SLACK_TOKEN"
  | "GOOGLE_API_KEY"
  | "AZURE_KEY"
  | "HARDCODED_PASSWORD"
  | "ENV_VARIABLE"
  | "HIGH_ENTROPY";

export type PiiType =
  | "EMAIL"
  | "PHONE"
  | "AADHAAR"
  | "PAN"
  | "SSN"
  | "CREDIT_CARD"
  | "IP_ADDRESS";

export type SecretMatch = {
  type: SecretType;
  value: string;
  position: number;
  length: number;
  severity: Severity;
};

export type PiiMatch = {
  type: PiiType;
  value: string;
  position: number;
  length: number;
  severity: Severity;
};

export type SecretScanResult = {
  hasSecrets: boolean;
  secrets: SecretMatch[];
};

export type PiiScanResult = {
  hasPII: boolean;
  pii: PiiMatch[];
};

export type PromptInjectionMatch = {
  pattern: string;
  matched: string;
  position: number;
  weight: number;
};

export type PromptInjectionResult = {
  score: number;
  isInjection: boolean;
  matches: PromptInjectionMatch[];
};

export type ContextAdjustment = {
  matchType: string;
  originalSeverity: Severity;
  adjustedSeverity: Severity;
  reason: string;
};

// ── Unicode Normalizer Types ──────────────────────────────────────────

export type UnicodeAnomalyType =
  | "ZERO_WIDTH_CHAR"
  | "CONFUSABLE_CHAR"
  | "BIDI_OVERRIDE"
  | "INVISIBLE_CHAR";

export type UnicodeAnomaly = {
  type: UnicodeAnomalyType;
  original: string;
  position: number;
  replacement: string;
  description: string;
};

export type UnicodeNormalizerResult = {
  normalizedText: string;
  findings: UnicodeAnomaly[];
  hasAnomalies: boolean;
};

/** Aggregate result from running the full scanner pipeline */
export type ScanPipelineResult = {
  action: "ALLOW" | "BLOCK" | "REDACT";
  riskScore: number;
  secretsFound: number;
  piiFound: number;
  entropyFound: number;
  injectionScore: number;
  isInjection: boolean;
  reasons: string[];
  secrets: SecretMatch[];
  pii: PiiMatch[];
};
