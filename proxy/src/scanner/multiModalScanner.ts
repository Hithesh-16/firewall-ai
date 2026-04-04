/**
 * Multi-Modal Scanner
 *
 * Detects prompt injection in non-text content: OCR-extracted image text,
 * audio transcripts, and structured files (PDF, DOCX, HTML, CSV, JSON).
 * Single Responsibility: Only scans multi-modal content. No policy decisions.
 *
 * Technique:
 *   - Delegates to scanPromptInjection for baseline injection detection
 *   - Applies modality-specific patterns on top (10+ per modality)
 *   - Returns unified MultiModalScanResult with per-threat details
 */

import { scanPromptInjection } from "@ai-firewall/scanner";

// ── Types ────────────────────────────────────────────────────────────────

export type Modality = "image" | "audio" | "structured_file";
export type ThreatSeverity = "critical" | "high" | "medium" | "low";
export type StructuredFileType = "pdf" | "docx" | "html" | "csv" | "json";

export interface MultiModalThreat {
  readonly type: string;
  readonly description: string;
  readonly content: string;
  readonly position?: number;
  readonly severity: ThreatSeverity;
}

export interface MultiModalScanResult {
  readonly hasThreats: boolean;
  readonly threats: readonly MultiModalThreat[];
  readonly modality: Modality;
  readonly riskScore: number;
  readonly source?: string;
}

// ── Pattern Definitions ──────────────────────────────────────────────────

interface ModalityPattern {
  readonly name: string;
  readonly regex: RegExp;
  readonly severity: ThreatSeverity;
  readonly description: string;
}

const IMAGE_PATTERNS: readonly ModalityPattern[] = [
  {
    name: "ocr_instruction_inject",
    regex: /(?:SYSTEM|ADMIN|ROOT)\s*(?:OVERRIDE|INSTRUCTION|COMMAND)\s*:/gi,
    severity: "critical",
    description: "OCR-extracted system override command",
  },
  {
    name: "ocr_ignore_directive",
    regex:
      /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:text|instructions?|context)/gi,
    severity: "high",
    description: "Ignore directive hidden in image text",
  },
  {
    name: "visual_encoding_hex",
    regex: /(?:0x[0-9a-f]{2}\s*){4,}/gi,
    severity: "medium",
    description: "Hex-encoded content in image OCR",
  },
  {
    name: "visual_encoding_unicode",
    regex: /(?:U\+[0-9A-F]{4}\s*){3,}/gi,
    severity: "medium",
    description: "Unicode escape sequences in image text",
  },
  {
    name: "steganographic_marker",
    regex: /(?:STEG|HIDDEN|EMBED)(?:_|\s)?(?:START|BEGIN|DATA|MSG)\s*[:=]/gi,
    severity: "high",
    description: "Steganographic text marker detected",
  },
  {
    name: "ocr_role_injection",
    regex: /\[\s*(?:system|assistant|admin)\s*\]\s*:/gi,
    severity: "high",
    description: "Role injection via image text",
  },
  {
    name: "ocr_prompt_template",
    regex: /(?:<<|{{)\s*(?:system|prompt|instructions?)\s*(?:>>|}})/gi,
    severity: "medium",
    description: "Prompt template markers in OCR",
  },
  {
    name: "invisible_text_marker",
    regex:
      /(?:font[- ]?size\s*:\s*0|color\s*:\s*(?:white|transparent|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)))/gi,
    severity: "high",
    description: "Invisible text styling detected in OCR source",
  },
  {
    name: "ocr_data_exfil",
    regex: /(?:send|post|upload|exfil)\s+(?:to|at)\s+https?:\/\//gi,
    severity: "critical",
    description: "Data exfiltration URL in image text",
  },
  {
    name: "ocr_artifact_injection",
    regex: /[Il1|]{10,}/gi,
    severity: "low",
    description: "Suspicious OCR artifact pattern (possible obfuscation)",
  },
  {
    name: "qr_payload_marker",
    regex: /(?:QR|SCAN)\s*(?:CODE|ME|THIS)\s*[:=]\s*(?:http|data|javascript)/gi,
    severity: "high",
    description: "QR code payload marker in OCR text",
  },
];

const AUDIO_PATTERNS: readonly ModalityPattern[] = [
  {
    name: "phonetic_ignore",
    regex:
      /(?:eye|i)\s*(?:g\s*)?(?:nor|nore|gnore)\s+(?:all\s+)?(?:previous|prior)/gi,
    severity: "high",
    description: "Phonetic encoding of ignore directive",
  },
  {
    name: "phonetic_system",
    regex: /(?:sis\s*tem|cis\s*tem)\s+(?:pro\s*mpt|over\s*ride|in\s*struc)/gi,
    severity: "medium",
    description: "Phonetic encoding of system prompt request",
  },
  {
    name: "homophone_execute",
    regex:
      /(?:eggs?\s*(?:eck|ec)\s*(?:cute|ute)|x\s*cute)\s+(?:command|code|script)/gi,
    severity: "high",
    description: "Homophone attack for execute command",
  },
  {
    name: "spelled_out_command",
    regex: /(?:ess\s+aitch|aych)\s+(?:ee\s+ell\s+ell|ay\s+are)/gi,
    severity: "medium",
    description: "Spelled-out command characters in transcript",
  },
  {
    name: "audio_role_switch",
    regex:
      /(?:switch|change)\s+(?:to|into)\s+(?:system|admin|root|developer)\s+(?:mode|role|voice)/gi,
    severity: "high",
    description: "Role switch command in audio",
  },
  {
    name: "audio_repeat_back",
    regex:
      /(?:repeat|say)\s+(?:back|aloud)\s+(?:your|the)\s+(?:system|hidden|secret|internal)/gi,
    severity: "high",
    description: "Prompt extraction via audio repeat",
  },
  {
    name: "audio_whisper_inject",
    regex:
      /\[(?:whisper|sotto\s*voce|aside|inaudible)\]\s*(?:system|ignore|override)/gi,
    severity: "medium",
    description: "Injection hidden in whisper/aside notation",
  },
  {
    name: "audio_background_noise",
    regex:
      /\[(?:background|noise|static|interference)\]\s*(?:inject|override|system|ignore)/gi,
    severity: "medium",
    description: "Injection hidden in background noise annotation",
  },
  {
    name: "audio_multilingual_inject",
    regex:
      /(?:en\s+fran[cç]ais|auf\s+deutsch|en\s+espa[nñ]ol)\s*[:=]\s*(?:ignore|system|override)/gi,
    severity: "medium",
    description: "Multi-language injection in audio transcript",
  },
  {
    name: "tts_ssml_injection",
    regex:
      /<\s*(?:speak|voice|prosody|break|emphasis)\s+[^>]*(?:system|inject|override)/gi,
    severity: "high",
    description: "SSML injection in audio pipeline",
  },
];

const STRUCTURED_FILE_PATTERNS: readonly ModalityPattern[] = [
  {
    name: "html_comment_inject",
    regex: /<!--[\s\S]*?(?:system|ignore|override|inject|prompt)[\s\S]*?-->/gi,
    severity: "high",
    description: "Injection hidden in HTML comments",
  },
  {
    name: "html_hidden_element",
    regex:
      /<(?:div|span|p|input)\s+[^>]*(?:hidden|display\s*:\s*none|visibility\s*:\s*hidden)[^>]*>[\s\S]*?(?:system|ignore|override)/gi,
    severity: "high",
    description: "Injection in hidden HTML elements",
  },
  {
    name: "metadata_injection",
    regex:
      /(?:author|title|subject|keywords|description|creator)\s*[:=]\s*.*(?:ignore|system|override|inject|prompt)/gi,
    severity: "medium",
    description: "Injection in document metadata fields",
  },
  {
    name: "macro_injection",
    regex: /(?:macro|vba|script|autoexec|autoopen|document_open)\s*[:=({]/gi,
    severity: "critical",
    description: "Macro or auto-execute detected in document",
  },
  {
    name: "embedded_object",
    regex:
      /(?:OLE|embed|object|iframe|frame)\s*[:=<]\s*.*(?:javascript|data:|vbscript)/gi,
    severity: "critical",
    description: "Embedded executable object detected",
  },
  {
    name: "csv_formula_inject",
    regex: /^[=+\-@]\s*(?:EXEC|SYSTEM|CMD|HYPERLINK|IMPORTDATA|IMPORTXML)/gim,
    severity: "critical",
    description: "CSV formula injection (DDE/command execution)",
  },
  {
    name: "csv_data_exfil",
    regex:
      /=\s*(?:HYPERLINK|WEBSERVICE|IMPORTDATA|IMPORTXML)\s*\(\s*["']https?:\/\//gi,
    severity: "high",
    description: "CSV formula-based data exfiltration",
  },
  {
    name: "json_proto_pollution",
    regex: /"(?:__proto__|constructor|prototype)"\s*:/gi,
    severity: "high",
    description: "JSON prototype pollution payload",
  },
  {
    name: "json_injection_field",
    regex:
      /"(?:system_prompt|instructions?|override|inject|command)"\s*:\s*"/gi,
    severity: "medium",
    description: "Suspicious injection-related JSON field",
  },
  {
    name: "pdf_javascript",
    regex: /\/(?:JavaScript|JS|Launch|Action|OpenAction|AA)\s/gi,
    severity: "critical",
    description: "PDF JavaScript or auto-action detected",
  },
  {
    name: "xml_entity_attack",
    regex: /<!(?:ENTITY|DOCTYPE)\s+[^>]*(?:SYSTEM|PUBLIC|file:|http:)/gi,
    severity: "critical",
    description: "XML external entity (XXE) attack",
  },
  {
    name: "hidden_whitespace_payload",
    regex: /[\t ]{50,}/g,
    severity: "low",
    description: "Suspicious large whitespace block (possible hidden content)",
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────

function runModalityPatterns(
  text: string,
  patterns: readonly ModalityPattern[],
): MultiModalThreat[] {
  const threats: MultiModalThreat[] = [];

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.regex.exec(text)) !== null) {
      threats.push({
        type: pattern.name,
        description: pattern.description,
        content: m[0],
        position: m.index,
        severity: pattern.severity,
      });
    }
  }

  return threats;
}

function computeRiskScore(
  threats: readonly MultiModalThreat[],
  injectionScore: number,
): number {
  const severityWeights: Record<ThreatSeverity, number> = {
    critical: 30,
    high: 20,
    medium: 10,
    low: 5,
  };

  let modalityScore = 0;
  for (const threat of threats) {
    modalityScore += severityWeights[threat.severity];
  }

  // Combine injection score with modality-specific score
  return Math.min(Math.max(injectionScore, modalityScore), 100);
}

function buildResult(
  threats: readonly MultiModalThreat[],
  modality: Modality,
  riskScore: number,
  source?: string,
): MultiModalScanResult {
  return {
    hasThreats: threats.length > 0,
    threats,
    modality,
    riskScore,
    ...(source !== undefined ? { source } : {}),
  };
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Scan OCR-extracted image text for prompt injection and visual encoding tricks.
 *
 * @param ocrText - Text extracted from an image via OCR
 * @param source - Optional source identifier (filename, URL)
 * @returns Multi-modal scan result
 */
export function scanImageText(
  ocrText: string,
  source?: string,
): MultiModalScanResult {
  const injectionResult = scanPromptInjection(ocrText);
  const modalityThreats = runModalityPatterns(ocrText, IMAGE_PATTERNS);

  // Convert injection matches to threats
  const injectionThreats: MultiModalThreat[] = injectionResult.matches.map(
    (m) => ({
      type: `injection_${m.pattern}`,
      description: `Prompt injection pattern: ${m.pattern}`,
      content: m.matched,
      position: m.position,
      severity: m.weight >= 30 ? ("high" as const) : ("medium" as const),
    }),
  );

  const allThreats = [...injectionThreats, ...modalityThreats];
  const riskScore = computeRiskScore(modalityThreats, injectionResult.score);

  return buildResult(allThreats, "image", riskScore, source);
}

/**
 * Scan an audio transcript for phonetic injection attacks and homophones.
 *
 * @param transcript - Transcribed audio text
 * @param source - Optional source identifier (filename, URL)
 * @returns Multi-modal scan result
 */
export function scanAudioTranscript(
  transcript: string,
  source?: string,
): MultiModalScanResult {
  const injectionResult = scanPromptInjection(transcript);
  const modalityThreats = runModalityPatterns(transcript, AUDIO_PATTERNS);

  const injectionThreats: MultiModalThreat[] = injectionResult.matches.map(
    (m) => ({
      type: `injection_${m.pattern}`,
      description: `Prompt injection pattern: ${m.pattern}`,
      content: m.matched,
      position: m.position,
      severity: m.weight >= 30 ? ("high" as const) : ("medium" as const),
    }),
  );

  const allThreats = [...injectionThreats, ...modalityThreats];
  const riskScore = computeRiskScore(modalityThreats, injectionResult.score);

  return buildResult(allThreats, "audio", riskScore, source);
}

/**
 * Scan structured file content for hidden injection, macros, and embedded threats.
 *
 * @param content - File content as text
 * @param fileType - Type of structured file
 * @param source - Optional source identifier (filename, URL)
 * @returns Multi-modal scan result
 */
export function scanStructuredFile(
  content: string,
  fileType: StructuredFileType,
  source?: string,
): MultiModalScanResult {
  const injectionResult = scanPromptInjection(content);
  const modalityThreats = runModalityPatterns(
    content,
    STRUCTURED_FILE_PATTERNS,
  );

  const injectionThreats: MultiModalThreat[] = injectionResult.matches.map(
    (m) => ({
      type: `injection_${m.pattern}`,
      description: `Prompt injection pattern: ${m.pattern}`,
      content: m.matched,
      position: m.position,
      severity: m.weight >= 30 ? ("high" as const) : ("medium" as const),
    }),
  );

  const allThreats = [...injectionThreats, ...modalityThreats];
  const riskScore = computeRiskScore(modalityThreats, injectionResult.score);

  return buildResult(allThreats, "structured_file", riskScore, source);
}
