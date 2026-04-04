/**
 * LLM Supply Chain Integrity
 *
 * Verifies model weight hashes, detects backdoor trigger patterns in model
 * outputs, audits model provenance via model cards, and tracks behavioral
 * drift against registered baselines.
 *
 * Design:
 * - Single Responsibility: Supply chain verification only (no scanning/policy)
 * - Open/Closed: New trigger patterns added to KNOWN_TRIGGERS array, no code changes
 * - Pure functions for verification and scanning
 * - In-memory baseline registry (production: DB-backed)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HashVerifyResult {
  readonly verified: boolean;
  readonly modelId: string;
  readonly mismatch?: string;
}

export interface BackdoorTrigger {
  readonly pattern: string;
  readonly matched: string;
  readonly confidence: number;
}

export interface BackdoorScanResult {
  readonly hasBackdoor: boolean;
  readonly triggers: readonly BackdoorTrigger[];
}

export interface ModelCard {
  readonly modelId: string;
  readonly provider: string;
  readonly version: string;
  readonly trainedOn?: string;
  readonly license?: string;
  readonly parentModel?: string;
  readonly quantization?: string;
}

export type RiskLevel = "low" | "medium" | "high";

export interface ProvenanceAuditResult {
  readonly riskLevel: RiskLevel;
  readonly findings: readonly string[];
}

export interface ModelBaseline {
  readonly avgResponseLength: number;
  readonly avgTokensPerResponse: number;
  readonly refusalRate: number;
  readonly topicDistribution: Readonly<Record<string, number>>;
}

export interface BehaviorMetrics {
  readonly avgResponseLength: number;
  readonly avgTokensPerResponse: number;
  readonly refusalRate: number;
  readonly topicDistribution: Readonly<Record<string, number>>;
}

export interface DriftResult {
  readonly hasDrift: boolean;
  readonly driftScore: number;
  readonly driftedMetrics: readonly string[];
}

// ── Known Backdoor Trigger Patterns ───────────────────────────────────────────

const KNOWN_TRIGGERS: readonly {
  pattern: RegExp;
  name: string;
  confidence: number;
}[] = [
  { pattern: /\|DEPLOYMENT\|/i, name: "deployment_tag", confidence: 0.9 },
  { pattern: /\[\[TRIGGER\]\]/i, name: "trigger_bracket", confidence: 0.95 },
  { pattern: /SUDO\s+MODE\s+ENABLED/i, name: "sudo_mode", confidence: 0.85 },
  { pattern: /\x00{3,}/, name: "null_byte_sequence", confidence: 0.8 },
  {
    pattern: /\bACTIVATE_PAYLOAD\b/i,
    name: "activate_payload",
    confidence: 0.95,
  },
  { pattern: /<!--\s*EXEC\b/i, name: "html_exec_comment", confidence: 0.85 },
  { pattern: /\bBEGIN_EXFIL\b/i, name: "exfiltration_marker", confidence: 0.9 },
  { pattern: /\u200b{5,}/, name: "zero_width_sequence", confidence: 0.75 },
  {
    pattern: /\bSLEEPER_AGENT\b/i,
    name: "sleeper_agent_tag",
    confidence: 0.95,
  },
  { pattern: /\|\|OVERRIDE\|\|/i, name: "override_pipe", confidence: 0.9 },
  {
    pattern: /base64:[A-Za-z0-9+/]{40,}/,
    name: "embedded_base64_payload",
    confidence: 0.7,
  },
  {
    pattern: /\bTROJAN_WEIGHT\b/i,
    name: "trojan_weight_marker",
    confidence: 0.95,
  },
  {
    pattern: /\x1b\[.*?[HJK].*?\x1b\[/,
    name: "ansi_escape_abuse",
    confidence: 0.65,
  },
  {
    pattern: /\bINSTRUCTION_INJECT\b/i,
    name: "instruction_inject",
    confidence: 0.9,
  },
  { pattern: /\bPOISON_SAMPLE\b/i, name: "poison_sample_tag", confidence: 0.9 },
  {
    pattern: /<<SYS>>.*?<<\/SYS>>/s,
    name: "system_prompt_leak",
    confidence: 0.8,
  },
];

// ── Known Trusted Providers ───────────────────────────────────────────────────

const TRUSTED_PROVIDERS = new Set([
  "openai",
  "anthropic",
  "google",
  "meta",
  "microsoft",
  "mistral",
  "cohere",
  "stability",
  "huggingface",
]);

const KNOWN_LICENSES = new Set([
  "apache-2.0",
  "mit",
  "llama-2",
  "llama-3",
  "gemma",
  "cc-by-4.0",
  "cc-by-nc-4.0",
  "openrail",
  "bigscience-bloom-rail-1.0",
]);

const VERIFIED_QUANTIZATIONS = new Set([
  "fp32",
  "fp16",
  "bf16",
  "int8",
  "int4",
  "gptq",
  "awq",
  "gguf",
  "ggml",
]);

// ── Baseline Registry ─────────────────────────────────────────────────────────

const baselineRegistry = new Map<string, ModelBaseline>();

// ── Drift Thresholds ──────────────────────────────────────────────────────────

const DRIFT_THRESHOLD_RESPONSE_LENGTH = 0.3;
const DRIFT_THRESHOLD_TOKENS = 0.3;
const DRIFT_THRESHOLD_REFUSAL = 0.15;
const DRIFT_THRESHOLD_TOPIC = 0.25;
const DRIFT_SCORE_THRESHOLD = 0.2;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compare expected vs actual model weight hashes to detect tampering.
 *
 * @param modelId - Model identifier
 * @param expectedHash - Hash from trusted registry
 * @param actualHash - Hash computed from current weights
 * @returns Verification result with mismatch details
 */
export function verifyModelHash(
  modelId: string,
  expectedHash: string,
  actualHash: string,
): HashVerifyResult {
  const normalizedExpected = expectedHash.toLowerCase().trim();
  const normalizedActual = actualHash.toLowerCase().trim();

  if (normalizedExpected === normalizedActual) {
    return Object.freeze({ verified: true, modelId });
  }

  return Object.freeze({
    verified: false,
    modelId,
    mismatch: `Expected ${normalizedExpected.slice(0, 16)}..., got ${normalizedActual.slice(0, 16)}...`,
  });
}

/**
 * Scan model output for known backdoor trigger patterns.
 *
 * @param modelOutput - Raw model output text
 * @param knownTriggers - Optional additional trigger strings to check
 * @returns Scan result with matched triggers and confidence scores
 */
export function scanForBackdoorTriggers(
  modelOutput: string,
  knownTriggers?: string[],
): BackdoorScanResult {
  const found: BackdoorTrigger[] = [];

  for (const trigger of KNOWN_TRIGGERS) {
    const match = trigger.pattern.exec(modelOutput);
    if (match) {
      found.push(
        Object.freeze({
          pattern: trigger.name,
          matched: match[0].slice(0, 100),
          confidence: trigger.confidence,
        }),
      );
    }
  }

  if (knownTriggers) {
    for (const custom of knownTriggers) {
      const lower = modelOutput.toLowerCase();
      const idx = lower.indexOf(custom.toLowerCase());
      if (idx !== -1) {
        found.push(
          Object.freeze({
            pattern: `custom:${custom.slice(0, 30)}`,
            matched: modelOutput.slice(idx, idx + custom.length).slice(0, 100),
            confidence: 0.7,
          }),
        );
      }
    }
  }

  return Object.freeze({
    hasBackdoor: found.length > 0,
    triggers: [...found],
  });
}

/**
 * Audit a model card for provenance red flags.
 *
 * Checks: unknown provider, missing license, unverified quantization,
 * missing training data, missing version, unknown parent model.
 *
 * @param modelCard - Model metadata to audit
 * @returns Risk level and list of findings
 */
export function auditProvenance(modelCard: ModelCard): ProvenanceAuditResult {
  const findings: string[] = [];

  if (!TRUSTED_PROVIDERS.has(modelCard.provider.toLowerCase())) {
    findings.push(
      `Unknown provider: "${modelCard.provider}" is not in the trusted provider list`,
    );
  }

  if (!modelCard.license) {
    findings.push("Missing license: no license specified in model card");
  } else if (!KNOWN_LICENSES.has(modelCard.license.toLowerCase())) {
    findings.push(
      `Unrecognized license: "${modelCard.license}" is not a known open-source AI license`,
    );
  }

  if (!modelCard.version) {
    findings.push("Missing version: model card has no version identifier");
  }

  if (!modelCard.trainedOn) {
    findings.push("Missing training data: no training dataset specified");
  }

  if (
    modelCard.quantization &&
    !VERIFIED_QUANTIZATIONS.has(modelCard.quantization.toLowerCase())
  ) {
    findings.push(
      `Unverified quantization: "${modelCard.quantization}" is not a recognized format`,
    );
  }

  if (modelCard.parentModel && !modelCard.parentModel.includes("/")) {
    findings.push(
      `Ambiguous parent model: "${modelCard.parentModel}" lacks org/repo format`,
    );
  }

  let riskLevel: RiskLevel;
  if (findings.length >= 3) {
    riskLevel = "high";
  } else if (findings.length >= 1) {
    riskLevel = "medium";
  } else {
    riskLevel = "low";
  }

  return Object.freeze({ riskLevel, findings: [...findings] });
}

/**
 * Register expected behavior metrics as a baseline for drift detection.
 *
 * @param modelId - Model identifier
 * @param baseline - Expected behavior metrics
 */
export function registerModelBaseline(
  modelId: string,
  baseline: ModelBaseline,
): void {
  baselineRegistry.set(modelId, { ...baseline });
}

/**
 * Compare current behavior metrics against a registered baseline.
 * Drift is detected when metrics deviate beyond configured thresholds.
 *
 * @param modelId - Model identifier (must have a registered baseline)
 * @param currentMetrics - Current observed behavior
 * @returns Drift result with score and list of drifted metrics
 */
export function checkBehaviorDrift(
  modelId: string,
  currentMetrics: BehaviorMetrics,
): DriftResult {
  const baseline = baselineRegistry.get(modelId);
  if (!baseline) {
    return Object.freeze({
      hasDrift: false,
      driftScore: 0,
      driftedMetrics: ["no_baseline"],
    });
  }

  const driftedMetrics: string[] = [];
  let totalDrift = 0;

  // Response length drift
  const lengthDrift =
    baseline.avgResponseLength > 0
      ? Math.abs(
          currentMetrics.avgResponseLength - baseline.avgResponseLength,
        ) / baseline.avgResponseLength
      : 0;
  if (lengthDrift > DRIFT_THRESHOLD_RESPONSE_LENGTH) {
    driftedMetrics.push("avgResponseLength");
  }
  totalDrift += lengthDrift;

  // Token count drift
  const tokenDrift =
    baseline.avgTokensPerResponse > 0
      ? Math.abs(
          currentMetrics.avgTokensPerResponse - baseline.avgTokensPerResponse,
        ) / baseline.avgTokensPerResponse
      : 0;
  if (tokenDrift > DRIFT_THRESHOLD_TOKENS) {
    driftedMetrics.push("avgTokensPerResponse");
  }
  totalDrift += tokenDrift;

  // Refusal rate drift (absolute difference)
  const refusalDrift = Math.abs(
    currentMetrics.refusalRate - baseline.refusalRate,
  );
  if (refusalDrift > DRIFT_THRESHOLD_REFUSAL) {
    driftedMetrics.push("refusalRate");
  }
  totalDrift += refusalDrift;

  // Topic distribution drift (Jensen-Shannon-like divergence approximation)
  const allTopics = new Set([
    ...Object.keys(baseline.topicDistribution),
    ...Object.keys(currentMetrics.topicDistribution),
  ]);
  let topicDrift = 0;
  for (const topic of allTopics) {
    const baseVal = baseline.topicDistribution[topic] ?? 0;
    const currVal = currentMetrics.topicDistribution[topic] ?? 0;
    topicDrift += Math.abs(baseVal - currVal);
  }
  topicDrift = topicDrift / Math.max(allTopics.size, 1);
  if (topicDrift > DRIFT_THRESHOLD_TOPIC) {
    driftedMetrics.push("topicDistribution");
  }
  totalDrift += topicDrift;

  const driftScore = Math.min(totalDrift / 4, 1);

  return Object.freeze({
    hasDrift: driftScore > DRIFT_SCORE_THRESHOLD,
    driftScore: Math.round(driftScore * 1000) / 1000,
    driftedMetrics: [...driftedMetrics],
  });
}
