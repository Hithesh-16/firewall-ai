/**
 * Unicode Normalizer
 *
 * Normalizes text before it reaches any scanner to prevent bypass attacks
 * using homoglyphs, zero-width characters, and bidirectional overrides.
 *
 * MUST run before all other scanners in the pipeline. Without this,
 * Cyrillic "а" (U+0430) bypasses all ASCII-regex secret/injection patterns.
 *
 * Single Responsibility: Only normalizes text and reports findings.
 * No policy decisions, no side effects.
 *
 * Defends against: ASI04 (Rules File Backdoor), encoding bypass attacks.
 */

import type {
  UnicodeAnomaly,
  UnicodeAnomalyType,
  UnicodeNormalizerResult,
} from "./types";

// ── Zero-width characters to strip ──────────────────────────────────────

const ZERO_WIDTH_CHARS = new Set([
  "\u200B", // Zero-width space
  "\u200C", // Zero-width non-joiner
  "\u200D", // Zero-width joiner
  "\uFEFF", // BOM / Zero-width no-break space
  "\u2060", // Word joiner
  "\u00AD", // Soft hyphen
  "\u200E", // Left-to-right mark
  "\u200F", // Right-to-left mark
  "\u2061", // Function application
  "\u2062", // Invisible times
  "\u2063", // Invisible separator
  "\u2064", // Invisible plus
  "\u180E", // Mongolian vowel separator
]);

// ── Bidirectional override characters to strip ──────────────────────────

const BIDI_CHARS = new Set([
  "\u202A", // Left-to-right embedding
  "\u202B", // Right-to-left embedding
  "\u202C", // Pop directional formatting
  "\u202D", // Left-to-right override
  "\u202E", // Right-to-left override
  "\u2066", // Left-to-right isolate
  "\u2067", // Right-to-left isolate
  "\u2068", // First strong isolate
  "\u2069", // Pop directional isolate
]);

// ── Confusable character map (visual lookalikes → ASCII) ────────────────
// Covers Cyrillic and Greek characters commonly used to bypass Latin regex.
// ~45 entries covering the most exploited confusables.

const CONFUSABLE_MAP = new Map<string, string>([
  // Cyrillic lowercase → Latin
  ["\u0430", "a"], // а → a
  ["\u0435", "e"], // е → e
  ["\u043E", "o"], // о → o
  ["\u0440", "p"], // р → p
  ["\u0441", "c"], // с → c
  ["\u0443", "y"], // у → y
  ["\u0445", "x"], // х → x
  ["\u0456", "i"], // і → i (Ukrainian)
  ["\u0458", "j"], // ј → j (Serbian)
  ["\u04BB", "h"], // һ → h
  ["\u0455", "s"], // ѕ → s
  ["\u0471", "ψ"], // skip — not a Latin confusable
  ["\u051B", "q"], // ԛ → q
  ["\u051D", "w"], // ԝ → w

  // Cyrillic uppercase → Latin
  ["\u0410", "A"], // А → A
  ["\u0412", "B"], // В → B
  ["\u0415", "E"], // Е → E
  ["\u041A", "K"], // К → K
  ["\u041C", "M"], // М → M
  ["\u041D", "H"], // Н → H
  ["\u041E", "O"], // О → O
  ["\u0420", "P"], // Р → P
  ["\u0421", "C"], // С → C
  ["\u0422", "T"], // Т → T
  ["\u0425", "X"], // Х → X

  // Greek lowercase → Latin
  ["\u03BF", "o"], // ο → o
  ["\u03B1", "a"], // α → a (close enough for bypass)
  ["\u03B5", "e"], // ε → e
  ["\u03B9", "i"], // ι → i
  ["\u03BA", "k"], // κ → k
  ["\u03BD", "v"], // ν → v
  ["\u03C4", "t"], // τ → t
  ["\u03C1", "p"], // ρ → p
  ["\u03C5", "u"], // υ → u

  // Greek uppercase → Latin
  ["\u0391", "A"], // Α → A
  ["\u0392", "B"], // Β → B
  ["\u0395", "E"], // Ε → E
  ["\u0397", "H"], // Η → H
  ["\u0399", "I"], // Ι → I
  ["\u039A", "K"], // Κ → K
  ["\u039C", "M"], // Μ → M
  ["\u039D", "N"], // Ν → N
  ["\u039F", "O"], // Ο → O
  ["\u03A1", "P"], // Ρ → P
  ["\u03A4", "T"], // Τ → T
  ["\u03A7", "X"], // Χ → X
  ["\u0396", "Z"], // Ζ → Z

  // Fullwidth Latin → ASCII
  ["\uFF21", "A"], ["\uFF22", "B"], ["\uFF23", "C"],
  ["\uFF41", "a"], ["\uFF42", "b"], ["\uFF43", "c"],
]);

// ── Core Normalizer ─────────────────────────────────────────────────────

/**
 * Normalize text by stripping zero-width characters, replacing confusable
 * characters with their ASCII equivalents, and removing bidi overrides.
 *
 * Returns the normalized text plus an array of all anomalies found.
 * Pure function — no side effects.
 *
 * @param text - Raw input text
 * @returns Normalized text and anomaly findings
 */
export function normalizeUnicode(text: string): UnicodeNormalizerResult {
  if (!text) {
    return { normalizedText: "", findings: [], hasAnomalies: false };
  }

  const findings: UnicodeAnomaly[] = [];
  const chars: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    // Check zero-width characters
    if (ZERO_WIDTH_CHARS.has(char)) {
      findings.push({
        type: "ZERO_WIDTH_CHAR",
        original: char,
        position: i,
        replacement: "",
        description: `Zero-width character U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")} removed`,
      });
      continue; // Strip the character
    }

    // Check bidi overrides
    if (BIDI_CHARS.has(char)) {
      findings.push({
        type: "BIDI_OVERRIDE",
        original: char,
        position: i,
        replacement: "",
        description: `Bidirectional override U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")} removed`,
      });
      continue; // Strip the character
    }

    // Check confusable characters
    const replacement = CONFUSABLE_MAP.get(char);
    if (replacement !== undefined) {
      findings.push({
        type: "CONFUSABLE_CHAR",
        original: char,
        position: i,
        replacement,
        description: `Confusable U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")} replaced with '${replacement}'`,
      });
      chars.push(replacement);
      continue;
    }

    // Check for other invisible/control characters (C0/C1 except common ones)
    const code = char.codePointAt(0)!;
    if (
      code !== 0x09 && // tab
      code !== 0x0A && // newline
      code !== 0x0D && // carriage return
      code !== 0x20 && // space
      ((code >= 0x00 && code <= 0x08) ||
       (code >= 0x0E && code <= 0x1F) ||
       (code >= 0x7F && code <= 0x9F) ||
       code === 0x2028 || // line separator
       code === 0x2029)   // paragraph separator
    ) {
      findings.push({
        type: "INVISIBLE_CHAR",
        original: char,
        position: i,
        replacement: "",
        description: `Invisible control character U+${code.toString(16).toUpperCase().padStart(4, "0")} removed`,
      });
      continue; // Strip the character
    }

    chars.push(char);
  }

  // Apply NFC normalization to collapse combining characters
  const joined = chars.join("");
  const normalizedText = joined.normalize("NFC");

  return {
    normalizedText,
    findings,
    hasAnomalies: findings.length > 0,
  };
}
