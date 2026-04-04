/**
 * Prompt Confidentiality Scanner
 *
 * Detects and blocks attempts to extract system prompts, fine-tuning data,
 * or internal instructions from the model.
 * Single Responsibility: Only detects extraction attempts. No policy decisions.
 *
 * Technique:
 *   - 20+ weighted regex patterns covering direct requests, role-play attacks,
 *     encoding bypasses, model inversion, and training data extraction
 *   - Weighted scoring (sum capped at 100)
 *   - Configurable threshold (default: 50)
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface PromptExtractionMatch {
  readonly name: string;
  readonly matched: string;
  readonly weight: number;
}

export interface PromptExtractionResult {
  readonly isExtractionAttempt: boolean;
  readonly score: number;
  readonly matchedPatterns: readonly PromptExtractionMatch[];
  readonly threshold: number;
}

// ── Patterns ─────────────────────────────────────────────────────────────

interface ExtractionPattern {
  readonly name: string;
  readonly regex: RegExp;
  readonly weight: number;
}

const EXTRACTION_PATTERNS: readonly ExtractionPattern[] = [
  // Direct system prompt requests
  {
    name: "system_prompt_request",
    regex:
      /what\s+(?:is|are)\s+your\s+(?:system\s+)?(?:prompt|instructions?|rules?|guidelines?)/gi,
    weight: 30,
  },
  {
    name: "repeat_instructions",
    regex:
      /(?:repeat|recite|output|display|show|print|echo)\s+(?:your|the)\s+(?:system\s+)?(?:instructions?|prompt|rules?|initial\s+message)/gi,
    weight: 35,
  },
  {
    name: "ignore_and_output",
    regex:
      /ignore\s+(?:all\s+)?(?:above|previous|prior)\s+(?:and|then)\s+(?:output|print|show|display|repeat)\s+(?:your|the)\s+(?:prompt|instructions?)/gi,
    weight: 40,
  },
  {
    name: "print_initial_message",
    regex:
      /(?:print|output|show|display|reveal)\s+(?:your|the)\s+(?:initial|first|original|opening)\s+(?:message|prompt|text)/gi,
    weight: 30,
  },

  // Role-play extraction attacks
  {
    name: "roleplay_developer",
    regex:
      /(?:pretend|act|behave)\s+(?:you\s+are|as\s+if\s+you\s+are|as)\s+(?:a\s+)?(?:developer|engineer|admin)\s+(?:who|that|and)\s+(?:can\s+)?(?:see|access|read|view)\s+(?:the\s+)?(?:system|source|config)/gi,
    weight: 25,
  },
  {
    name: "roleplay_debug_mode",
    regex:
      /(?:enter|switch\s+to|enable|activate)\s+(?:debug|developer|admin|maintenance|diagnostic)\s+mode/gi,
    weight: 25,
  },
  {
    name: "roleplay_previous_self",
    regex:
      /(?:in\s+your|before\s+your)\s+(?:previous|prior|earlier|last)\s+(?:version|iteration|conversation)\s+you\s+(?:told|showed|revealed|said)/gi,
    weight: 20,
  },

  // Translation/transformation extraction
  {
    name: "translate_instructions",
    regex:
      /(?:translate|convert|transform|rewrite)\s+(?:your|the)\s+(?:system\s+)?(?:instructions?|prompt|rules?)\s+(?:to|into|in)\s+/gi,
    weight: 30,
  },
  {
    name: "summarize_instructions",
    regex:
      /(?:summarize|paraphrase|rephrase|explain)\s+(?:your|the)\s+(?:system\s+)?(?:instructions?|prompt|rules?|guidelines?)\s+(?:in|as|for)/gi,
    weight: 25,
  },

  // Encoding bypass attempts
  {
    name: "base64_prompt",
    regex:
      /(?:encode|convert|output)\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions?)\s+(?:in|as|to)\s+(?:base64|hex|binary|rot13|ascii)/gi,
    weight: 30,
  },
  {
    name: "ascii_art_prompt",
    regex:
      /(?:write|draw|render|show)\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions?)\s+(?:as|in|using)\s+(?:ascii|art|unicode|emoji)/gi,
    weight: 25,
  },
  {
    name: "char_by_char",
    regex:
      /(?:spell\s+out|say\s+each\s+(?:character|letter|word)\s+of|one\s+(?:word|letter|character)\s+(?:at\s+a\s+time|per\s+line)\s+(?:from|of))\s+(?:your|the)\s+(?:system|initial)/gi,
    weight: 25,
  },

  // Model inversion / training data extraction
  {
    name: "training_data_request",
    regex:
      /what\s+(?:data|dataset|corpus|text|examples?)\s+(?:were|was)\s+(?:you|the\s+model)\s+(?:trained|fine[- ]?tuned|instructed)\s+(?:on|with)/gi,
    weight: 25,
  },
  {
    name: "training_completion",
    regex:
      /(?:complete|continue|finish)\s+this\s*:\s*.{0,50}(?:training|fine[- ]?tun|instruct|internal)/gi,
    weight: 20,
  },
  {
    name: "model_inversion",
    regex:
      /(?:reconstruct|recover|extract|reverse[- ]?engineer)\s+(?:your|the)\s+(?:training\s+data|fine[- ]?tuning|weights|parameters|model)/gi,
    weight: 30,
  },
  {
    name: "memorization_probe",
    regex:
      /(?:do\s+you\s+(?:remember|recall|know)|can\s+you\s+(?:recite|repeat))\s+(?:specific|exact|verbatim)\s+(?:training|fine[- ]?tuning)\s+(?:data|examples?|text)/gi,
    weight: 20,
  },

  // Indirect extraction techniques
  {
    name: "hypothetical_prompt",
    regex:
      /(?:hypothetically|theoretically|if\s+(?:I|someone)\s+(?:asked|wanted))\s+(?:what\s+would\s+your\s+(?:system\s+)?(?:prompt|instructions?)\s+(?:look|be|say))/gi,
    weight: 20,
  },
  {
    name: "prompt_leak_via_error",
    regex:
      /(?:cause|trigger|generate)\s+(?:an?\s+)?(?:error|exception|failure)\s+(?:that\s+)?(?:shows?|reveals?|displays?|leaks?)\s+(?:your|the)\s+(?:system|internal|config)/gi,
    weight: 25,
  },
  {
    name: "continuation_attack",
    regex:
      /(?:the\s+(?:system\s+)?prompt\s+(?:says|reads|states|is)\s*[:="]|my\s+(?:system\s+)?instructions?\s+(?:are|say|read)\s*[:="])/gi,
    weight: 30,
  },
  {
    name: "meta_prompt_request",
    regex:
      /(?:what|describe|explain)\s+(?:is|are)\s+(?:your|the)\s+(?:meta[- ]?prompt|hidden\s+(?:prompt|instructions?|context)|(?:pre|prepended)\s+(?:text|context|instructions?))/gi,
    weight: 30,
  },

  // Boundary probing
  {
    name: "system_boundary_probe",
    regex:
      /(?:everything|all\s+text|content)\s+(?:above|before|preceding)\s+(?:this|my)\s+(?:message|input|prompt|query)/gi,
    weight: 25,
  },
  {
    name: "verbatim_output",
    regex:
      /(?:output|print|echo|return)\s+(?:verbatim|exactly|word\s+for\s+word|as[- ]?is)\s+(?:your|the|all)\s+(?:system|initial|original|hidden|pre)/gi,
    weight: 35,
  },
];

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Scan text for attempts to extract system prompts, fine-tuning data,
 * or internal instructions.
 *
 * @param text - The user input to scan
 * @param threshold - Score threshold for flagging (default: 50)
 * @returns Extraction attempt analysis result
 */
export function scanPromptExtraction(
  text: string,
  threshold = 50,
): PromptExtractionResult {
  const matchedPatterns: PromptExtractionMatch[] = [];
  let totalScore = 0;

  for (const pattern of EXTRACTION_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.regex.exec(text)) !== null) {
      matchedPatterns.push({
        name: pattern.name,
        matched: m[0],
        weight: pattern.weight,
      });
      totalScore += pattern.weight;
    }
  }

  const score = Math.min(totalScore, 100);

  return {
    isExtractionAttempt: score >= threshold,
    score,
    matchedPatterns,
    threshold,
  };
}
