/**
 * Compliance Mapper
 *
 * Maps flagged security events to specific regulatory obligations across
 * GDPR, EU AI Act, HIPAA, NIST AI RMF, SOC 2, and ISO 42001.
 * Generates evidence packages for audit and compliance reporting.
 *
 * Design:
 * - Single Responsibility: Regulatory mapping only (no scanning or policy)
 * - Open/Closed: New regulations added to REGULATIONS array, no code changes
 * - Pure functions — no side effects, immutable returns
 */

import crypto from "node:crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SecurityEventType =
  | "pii_detected"
  | "secret_leaked"
  | "injection_blocked"
  | "hallucination"
  | "policy_violation"
  | "unauthorized_access";

export type Severity = "critical" | "high" | "medium" | "low";

export interface SecurityEvent {
  readonly type: SecurityEventType;
  readonly severity: Severity;
  readonly timestamp: number;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface ComplianceMapping {
  readonly regulation: string;
  readonly article: string;
  readonly title: string;
  readonly description: string;
  readonly relevance: "direct" | "indirect";
  readonly remediation: string;
}

export interface RegulationInfo {
  readonly name: string;
  readonly shortName: string;
  readonly articles: readonly string[];
  readonly jurisdiction: string;
}

export interface EvidencePackage {
  readonly id: string;
  readonly generatedAt: number;
  readonly timeRange: { readonly start: number; readonly end: number };
  readonly totalEvents: number;
  readonly eventsByRegulation: ReadonlyMap<string, readonly SecurityEvent[]>;
  readonly summary: string;
  readonly recommendations: readonly string[];
}

// ── Regulation Database ───────────────────────────────────────────────────────

interface RegulatoryArticle {
  readonly regulation: string;
  readonly article: string;
  readonly title: string;
  readonly description: string;
  readonly eventTypes: readonly SecurityEventType[];
  readonly minSeverity: Severity;
  readonly relevance: "direct" | "indirect";
  readonly remediation: string;
}

const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const REGULATORY_ARTICLES: readonly RegulatoryArticle[] = [
  // ── GDPR ──
  {
    regulation: "GDPR",
    article: "Art 5",
    title: "Principles of Processing",
    description:
      "Personal data must be processed lawfully, fairly, and transparently",
    eventTypes: ["pii_detected", "secret_leaked"],
    minSeverity: "medium",
    relevance: "direct",
    remediation:
      "Review data processing activities and ensure lawful basis for each",
  },
  {
    regulation: "GDPR",
    article: "Art 6",
    title: "Lawfulness of Processing",
    description:
      "Processing requires a lawful basis (consent, contract, legal obligation, etc.)",
    eventTypes: ["pii_detected"],
    minSeverity: "medium",
    relevance: "direct",
    remediation:
      "Verify consent or alternative lawful basis before processing PII through AI",
  },
  {
    regulation: "GDPR",
    article: "Art 9",
    title: "Special Categories of Data",
    description:
      "Processing of sensitive personal data requires explicit consent",
    eventTypes: ["pii_detected"],
    minSeverity: "high",
    relevance: "direct",
    remediation:
      "Block transmission of special category data (health, biometric, political) to AI providers",
  },
  {
    regulation: "GDPR",
    article: "Art 13",
    title: "Information to Data Subject",
    description:
      "Data subjects must be informed about automated decision-making",
    eventTypes: ["pii_detected", "hallucination"],
    minSeverity: "low",
    relevance: "indirect",
    remediation:
      "Ensure AI-assisted decisions are disclosed to affected individuals",
  },
  {
    regulation: "GDPR",
    article: "Art 17",
    title: "Right to Erasure",
    description: "Data subjects can request deletion of personal data",
    eventTypes: ["pii_detected"],
    minSeverity: "medium",
    relevance: "indirect",
    remediation:
      "Implement data deletion workflows for PII that may have been sent to AI providers",
  },
  {
    regulation: "GDPR",
    article: "Art 22",
    title: "Automated Decision-Making",
    description:
      "Right not to be subject to solely automated decisions with legal effects",
    eventTypes: ["hallucination", "policy_violation"],
    minSeverity: "medium",
    relevance: "direct",
    remediation:
      "Ensure human oversight for AI decisions that affect individuals",
  },
  {
    regulation: "GDPR",
    article: "Art 25",
    title: "Data Protection by Design",
    description: "Implement appropriate technical measures for data protection",
    eventTypes: ["pii_detected", "secret_leaked"],
    minSeverity: "low",
    relevance: "direct",
    remediation: "Deploy PII scanning and redaction in the AI pipeline",
  },
  {
    regulation: "GDPR",
    article: "Art 32",
    title: "Security of Processing",
    description:
      "Implement appropriate technical and organizational security measures",
    eventTypes: ["secret_leaked", "unauthorized_access"],
    minSeverity: "medium",
    relevance: "direct",
    remediation:
      "Enforce encryption, access controls, and secret scanning for all AI interactions",
  },
  {
    regulation: "GDPR",
    article: "Art 33",
    title: "Notification of Breach",
    description:
      "Notify supervisory authority within 72 hours of breach discovery",
    eventTypes: ["secret_leaked", "unauthorized_access"],
    minSeverity: "high",
    relevance: "direct",
    remediation: "Trigger breach notification workflow and document timeline",
  },
  {
    regulation: "GDPR",
    article: "Art 34",
    title: "Communication to Data Subject",
    description: "Notify affected individuals of high-risk breaches",
    eventTypes: ["pii_detected", "secret_leaked"],
    minSeverity: "critical",
    relevance: "direct",
    remediation:
      "Notify affected data subjects if PII was transmitted to untrusted AI providers",
  },

  // ── EU AI Act ──
  {
    regulation: "EU AI Act",
    article: "Art 9",
    title: "Risk Management System",
    description: "High-risk AI systems must have a risk management system",
    eventTypes: ["injection_blocked", "policy_violation", "hallucination"],
    minSeverity: "medium",
    relevance: "direct",
    remediation:
      "Document risk assessment and mitigation measures for AI system",
  },
  {
    regulation: "EU AI Act",
    article: "Art 13",
    title: "Transparency",
    description: "AI systems must be transparent and explainable",
    eventTypes: ["hallucination", "policy_violation"],
    minSeverity: "low",
    relevance: "direct",
    remediation:
      "Log all AI decisions with rationale and make available for audit",
  },
  {
    regulation: "EU AI Act",
    article: "Art 14",
    title: "Human Oversight",
    description: "High-risk AI must allow effective human oversight",
    eventTypes: ["policy_violation", "unauthorized_access"],
    minSeverity: "medium",
    relevance: "direct",
    remediation: "Implement approval workflows for high-risk AI actions",
  },
  {
    regulation: "EU AI Act",
    article: "Art 15",
    title: "Accuracy and Robustness",
    description: "AI systems must be resilient against adversarial attacks",
    eventTypes: ["injection_blocked"],
    minSeverity: "medium",
    relevance: "direct",
    remediation:
      "Strengthen prompt injection defenses and adversarial input filtering",
  },
  {
    regulation: "EU AI Act",
    article: "Art 52",
    title: "Transparency for AI-Generated Content",
    description: "Users must be informed when interacting with AI",
    eventTypes: ["hallucination"],
    minSeverity: "low",
    relevance: "indirect",
    remediation: "Label AI-generated content clearly in all outputs",
  },

  // ── HIPAA ──
  {
    regulation: "HIPAA",
    article: "§164.502",
    title: "Uses and Disclosures",
    description: "PHI may only be used or disclosed as permitted",
    eventTypes: ["pii_detected", "secret_leaked"],
    minSeverity: "high",
    relevance: "direct",
    remediation:
      "Block all PHI from being transmitted to AI providers without BAA",
  },
  {
    regulation: "HIPAA",
    article: "§164.514",
    title: "De-identification",
    description: "PHI must be de-identified before use in research/analytics",
    eventTypes: ["pii_detected"],
    minSeverity: "medium",
    relevance: "direct",
    remediation:
      "Apply PII redaction to remove all 18 HIPAA identifiers before AI processing",
  },
  {
    regulation: "HIPAA",
    article: "§164.524",
    title: "Access of Individuals",
    description: "Individuals have right to access their PHI",
    eventTypes: ["pii_detected"],
    minSeverity: "low",
    relevance: "indirect",
    remediation:
      "Maintain audit trail of PHI processed through AI for access requests",
  },
  {
    regulation: "HIPAA",
    article: "§164.530",
    title: "Administrative Requirements",
    description: "Covered entities must have policies and training",
    eventTypes: ["policy_violation", "unauthorized_access"],
    minSeverity: "medium",
    relevance: "indirect",
    remediation: "Document AI usage policies and train staff on PHI handling",
  },

  // ── NIST AI RMF ──
  {
    regulation: "NIST AI RMF",
    article: "MAP",
    title: "Context and Risk Framing",
    description: "Map AI risks to organizational context",
    eventTypes: ["policy_violation", "hallucination"],
    minSeverity: "low",
    relevance: "indirect",
    remediation: "Update AI risk register with findings from security events",
  },
  {
    regulation: "NIST AI RMF",
    article: "MEASURE",
    title: "Risk Assessment",
    description: "Quantify and track AI risks with metrics",
    eventTypes: ["injection_blocked", "pii_detected", "secret_leaked"],
    minSeverity: "low",
    relevance: "direct",
    remediation: "Track risk scores, finding counts, and trends over time",
  },
  {
    regulation: "NIST AI RMF",
    article: "MANAGE",
    title: "Risk Treatment",
    description: "Implement controls to treat identified risks",
    eventTypes: ["injection_blocked", "secret_leaked", "unauthorized_access"],
    minSeverity: "medium",
    relevance: "direct",
    remediation: "Apply BLOCK/REDACT policies for identified risk patterns",
  },
  {
    regulation: "NIST AI RMF",
    article: "GOVERN",
    title: "Governance",
    description: "Establish accountability and oversight structures",
    eventTypes: ["policy_violation", "unauthorized_access"],
    minSeverity: "medium",
    relevance: "direct",
    remediation: "Review governance policies and approval workflows",
  },

  // ── SOC 2 ──
  {
    regulation: "SOC 2",
    article: "CC6.1",
    title: "Logical Access Controls",
    description: "Restrict logical access to information assets",
    eventTypes: ["unauthorized_access", "secret_leaked"],
    minSeverity: "medium",
    relevance: "direct",
    remediation:
      "Review and tighten access controls for AI endpoints and API keys",
  },
  {
    regulation: "SOC 2",
    article: "CC6.6",
    title: "System Boundary Protection",
    description: "Restrict data transmission across system boundaries",
    eventTypes: ["pii_detected", "secret_leaked"],
    minSeverity: "medium",
    relevance: "direct",
    remediation:
      "Enforce scanning at all AI system boundaries (proxy, MCP gateway)",
  },
  {
    regulation: "SOC 2",
    article: "CC7.2",
    title: "System Monitoring",
    description: "Monitor system components for anomalies",
    eventTypes: ["injection_blocked", "policy_violation"],
    minSeverity: "low",
    relevance: "direct",
    remediation:
      "Review audit logs and alerting thresholds for AI-related anomalies",
  },
  {
    regulation: "SOC 2",
    article: "CC8.1",
    title: "Change Management",
    description: "Manage changes to system components",
    eventTypes: ["policy_violation"],
    minSeverity: "medium",
    relevance: "indirect",
    remediation:
      "Document policy changes and review impact on AI security controls",
  },

  // ── ISO 42001 ──
  {
    regulation: "ISO 42001",
    article: "6.1",
    title: "Risk Assessment",
    description: "Identify and assess AI-specific risks",
    eventTypes: ["injection_blocked", "hallucination", "policy_violation"],
    minSeverity: "low",
    relevance: "direct",
    remediation:
      "Update AI risk assessment with current threat landscape findings",
  },
  {
    regulation: "ISO 42001",
    article: "8.2",
    title: "AI Impact Assessment",
    description: "Assess impact of AI system on individuals and society",
    eventTypes: ["pii_detected", "hallucination"],
    minSeverity: "medium",
    relevance: "direct",
    remediation:
      "Conduct impact assessment for AI systems processing personal data",
  },
  {
    regulation: "ISO 42001",
    article: "8.4",
    title: "AI System Documentation",
    description: "Maintain documentation of AI system lifecycle",
    eventTypes: ["policy_violation", "unauthorized_access"],
    minSeverity: "low",
    relevance: "indirect",
    remediation: "Update system documentation with security event findings",
  },
  {
    regulation: "ISO 42001",
    article: "9.1",
    title: "Monitoring and Measurement",
    description: "Monitor AI system performance and compliance",
    eventTypes: ["injection_blocked", "pii_detected", "secret_leaked"],
    minSeverity: "low",
    relevance: "direct",
    remediation: "Review monitoring dashboards and compliance metrics",
  },
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Map a security event to all applicable regulatory obligations.
 *
 * @param event - Security event with type, severity, and details
 * @returns Sorted array of compliance mappings (direct first, then by regulation)
 */
export function mapToRegulations(event: SecurityEvent): ComplianceMapping[] {
  const eventSeverityRank = SEVERITY_RANK[event.severity];

  const mappings: ComplianceMapping[] = [];

  for (const article of REGULATORY_ARTICLES) {
    if (!article.eventTypes.includes(event.type)) {
      continue;
    }
    if (eventSeverityRank < SEVERITY_RANK[article.minSeverity]) {
      continue;
    }
    mappings.push(
      Object.freeze({
        regulation: article.regulation,
        article: article.article,
        title: article.title,
        description: article.description,
        relevance: article.relevance,
        remediation: article.remediation,
      }),
    );
  }

  return [...mappings].sort((a, b) => {
    if (a.relevance !== b.relevance) {
      return a.relevance === "direct" ? -1 : 1;
    }
    return a.regulation.localeCompare(b.regulation);
  });
}

/**
 * Generate a compliance evidence package from a set of security events.
 * Groups events by regulation for audit reporting.
 *
 * @param events - Array of security events to package
 * @param timeRange - Time window for the evidence package
 * @returns Evidence package with grouped events, summary, and recommendations
 */
export function generateEvidencePackage(
  events: SecurityEvent[],
  timeRange: { start: number; end: number },
): EvidencePackage {
  const filtered = events.filter(
    (e) => e.timestamp >= timeRange.start && e.timestamp <= timeRange.end,
  );

  const regulationEvents = new Map<string, SecurityEvent[]>();
  const regulationSet = new Set<string>();

  for (const event of filtered) {
    const mappings = mapToRegulations(event);
    for (const mapping of mappings) {
      const key = `${mapping.regulation} ${mapping.article}`;
      regulationSet.add(mapping.regulation);
      const existing = regulationEvents.get(key) ?? [];
      regulationEvents.set(key, [...existing, event]);
    }
  }

  const recommendations: string[] = [];
  const typeCounts: Record<string, number> = {};
  for (const event of filtered) {
    typeCounts[event.type] = (typeCounts[event.type] ?? 0) + 1;
  }

  if (typeCounts["pii_detected"]) {
    recommendations.push(
      "Review PII handling policies and strengthen redaction rules",
    );
  }
  if (typeCounts["secret_leaked"]) {
    recommendations.push(
      "Rotate potentially exposed credentials and tighten secret scanning patterns",
    );
  }
  if (typeCounts["injection_blocked"]) {
    recommendations.push(
      "Analyze blocked injection patterns and update threat intelligence feeds",
    );
  }
  if (typeCounts["unauthorized_access"]) {
    recommendations.push(
      "Audit access controls and review authentication mechanisms",
    );
  }
  if (typeCounts["hallucination"]) {
    recommendations.push(
      "Implement output validation and fact-checking for AI-generated content",
    );
  }
  if (typeCounts["policy_violation"]) {
    recommendations.push(
      "Review and update policy rules to address recurring violations",
    );
  }

  const regulationsList = [...regulationSet].sort().join(", ");
  const summary =
    filtered.length === 0
      ? "No security events found in the specified time range."
      : `${filtered.length} security event(s) mapped to ${regulationEvents.size} regulatory article(s) across ${regulationSet.size} regulation(s): ${regulationsList}.`;

  return Object.freeze({
    id: crypto.randomUUID(),
    generatedAt: Date.now(),
    timeRange: Object.freeze({ ...timeRange }),
    totalEvents: filtered.length,
    eventsByRegulation: regulationEvents as ReadonlyMap<
      string,
      readonly SecurityEvent[]
    >,
    summary,
    recommendations: [...recommendations],
  });
}

/**
 * Return metadata about all supported regulations.
 */
export function getSupportedRegulations(): RegulationInfo[] {
  const regulationMap = new Map<
    string,
    { articles: Set<string>; jurisdiction: string }
  >();

  const jurisdictions: Record<string, string> = {
    GDPR: "European Union",
    "EU AI Act": "European Union",
    HIPAA: "United States",
    "NIST AI RMF": "United States",
    "SOC 2": "International",
    "ISO 42001": "International",
  };

  for (const article of REGULATORY_ARTICLES) {
    const existing = regulationMap.get(article.regulation);
    if (existing) {
      existing.articles.add(article.article);
    } else {
      regulationMap.set(article.regulation, {
        articles: new Set([article.article]),
        jurisdiction: jurisdictions[article.regulation] ?? "Unknown",
      });
    }
  }

  return [...regulationMap.entries()].map(([name, info]) =>
    Object.freeze({
      name,
      shortName: name,
      articles: [...info.articles].sort(),
      jurisdiction: info.jurisdiction,
    }),
  );
}
