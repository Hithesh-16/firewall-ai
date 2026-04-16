import {
  FileScopeResult,
  PolicyConfig,
  PolicyDecision,
  PiiScanResult,
  SecretScanResult,
  Severity,
} from "../types";

const severityScore: Record<Severity, number> = {
  critical: 40,
  high: 20,
  medium: 10,
};

function thresholdToNumber(
  threshold: PolicyConfig["severity_threshold"],
): number {
  switch (threshold) {
    case "critical":
      return 80;
    case "high":
      return 60;
    case "medium":
    default:
      return 40;
  }
}

function calculateRisk(
  secretResult: SecretScanResult,
  piiResult: PiiScanResult,
): number {
  const raw =
    secretResult.secrets.reduce(
      (sum, item) => sum + severityScore[item.severity],
      0,
    ) +
    piiResult.pii.reduce((sum, item) => sum + severityScore[item.severity], 0);

  return Math.min(raw, 100);
}

export function evaluatePolicy(
  secretResult: SecretScanResult,
  piiResult: PiiScanResult,
  policy: PolicyConfig,
  fileScopeResults: FileScopeResult[] = [],
): PolicyDecision {
  const reasons: string[] = [];
  const blockedFiles = fileScopeResults.filter((x) => !x.allowed);
  const filesBlocked = blockedFiles.map((x) => x.path);

  if (blockedFiles.length > 0) {
    reasons.push(
      ...blockedFiles.map((x) => x.reason ?? `File blocked: ${x.path}`),
    );
    return {
      action: "BLOCK",
      reasons,
      riskScore: 100,
      filesBlocked,
    };
  }

  // Consent-first principle (per user directive 2026-04-17):
  // NEVER hard-block on content-scan findings. The user types their
  // own prompt; if it contains what looks like a secret we REDACT and
  // forward (the redactor replaces matched values with
  // `[REDACTED_<TYPE>]` tokens) and surface the findings via the
  // X-AF-Findings header → ScanResultBanner so the user can see what
  // was changed and override if needed. Hard BLOCK is reserved for
  // file-scope path-blocklist violations (above) where redaction is
  // meaningless because the path itself is the policy signal.
  //
  // Critical-severity secrets and private keys are still surfaced
  // with a high risk score and prominent banner — but we don't refuse
  // the request outright. Inform → consent → redact, never silent block.
  const hasCriticalSecret = secretResult.secrets.some(
    (s) => s.severity === "critical",
  );
  const hasPrivateKey = secretResult.secrets.some(
    (s) => s.type === "PRIVATE_KEY",
  );
  if (hasCriticalSecret || hasPrivateKey) {
    if (hasPrivateKey) reasons.push("Private key detected (redacted)");
    if (hasCriticalSecret && !hasPrivateKey)
      reasons.push("Critical secret detected (redacted)");
    return {
      action: "REDACT",
      reasons,
      riskScore: calculateRisk(secretResult, piiResult),
      filesBlocked,
    };
  }

  const riskScore = calculateRisk(secretResult, piiResult);
  const threshold = thresholdToNumber(policy.severity_threshold);

  const redactReasons: string[] = [];
  if (
    policy.rules.redact_emails &&
    piiResult.pii.some((p) => p.type === "EMAIL")
  ) {
    redactReasons.push("Email detected");
  }
  if (
    policy.rules.redact_phone &&
    piiResult.pii.some((p) => p.type === "PHONE")
  ) {
    redactReasons.push("Phone number detected");
  }
  if (
    policy.rules.redact_jwt &&
    secretResult.secrets.some((s) => s.type === "JWT")
  ) {
    redactReasons.push("JWT detected");
  }
  if (
    policy.rules.redact_generic_api_keys &&
    secretResult.secrets.some((s) => s.type === "GENERIC_API_KEY")
  ) {
    redactReasons.push("Generic API key detected");
  }
  if (riskScore >= threshold && (secretResult.hasSecrets || piiResult.hasPII)) {
    redactReasons.push(
      `Risk score exceeded threshold (${policy.severity_threshold})`,
    );
  }

  if (redactReasons.length > 0) {
    return {
      action: "REDACT",
      reasons: redactReasons,
      riskScore,
      filesBlocked,
    };
  }

  // Approval check: if enabled and risk exceeds threshold, require human approval
  if (
    policy.approval?.enabled &&
    riskScore >= (policy.approval.riskThreshold ?? 50)
  ) {
    return {
      action: "REQUIRE_APPROVAL",
      reasons: [
        `Risk score ${riskScore} exceeds approval threshold ${policy.approval.riskThreshold ?? 50}`,
      ],
      riskScore,
      filesBlocked,
    };
  }

  return {
    action: "ALLOW",
    reasons: [],
    riskScore,
    filesBlocked,
  };
}
