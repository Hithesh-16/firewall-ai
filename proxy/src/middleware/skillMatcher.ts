/**
 * Skill Auto-match Middleware — Phase L.L1
 * (SECURITY_HARDENING_PLAN.md).
 *
 * At chat-start, scans the user's latest message against loaded
 * skills' `description` and `trigger` fields using simple keyword
 * matching (Phase 1 — embedding-based matching tracked for Phase 2
 * once the embedding pipeline is stable across all surfaces).
 *
 * If a match exceeds the confidence threshold (>= 2 keyword hits),
 * the matched skill's `promptTemplate` body is injected as a system
 * message at the front of the conversation. Max 1 skill per request,
 * max 4 KB of injected text. Opt-in via `policy.json`
 * `skills.auto_match: true`.
 *
 * SOLID:
 *   - SRP: matching only. Skill loading is `skillLoader.ts`; prompt
 *     injection defense is the scanner pipeline.
 *   - DIP: takes `SkillDefinition[]` + message text; no IDE/proxy dep.
 */

import type { SkillDefinition } from "../skills/skillTypes";
import { loadAllSkills } from "../skills/skillLoader";

// ── Config ──────────────────────────────────────────────────────

const MAX_INJECTED_CHARS = 4096;
const MIN_KEYWORD_HITS = 2;

// ── Matching ────────────────────────────────────────────────────

/**
 * Extract lowercase keywords from a skill's description + trigger
 * fields. Short words (< 3 chars) and common stop-words are excluded
 * to reduce noise.
 */
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "use",
  "can",
  "all",
  "are",
  "was",
  "will",
  "has",
  "not",
  "but",
  "you",
  "your",
  "when",
  "how",
]);

function extractKeywords(skill: SkillDefinition): string[] {
  const text = `${skill.description} ${skill.trigger ?? ""}`.toLowerCase();
  return text
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

interface SkillMatch {
  skill: SkillDefinition;
  score: number;
  matchedKeywords: string[];
}

/**
 * Score each skill against the user's message text. Returns the
 * best match (if any) that meets the minimum keyword-hit threshold.
 */
export function matchSkill(
  userMessage: string,
  skills: readonly SkillDefinition[],
): SkillMatch | null {
  if (!userMessage || skills.length === 0) return null;

  const msgLower = userMessage.toLowerCase();
  let best: SkillMatch | null = null;

  for (const skill of skills) {
    const keywords = extractKeywords(skill);
    const hits = keywords.filter((kw) => msgLower.includes(kw));
    if (hits.length >= MIN_KEYWORD_HITS) {
      if (!best || hits.length > best.score) {
        best = { skill, score: hits.length, matchedKeywords: hits };
      }
    }
  }

  return best;
}

// ── Injection ───────────────────────────────────────────────────

/**
 * Build the system message to inject. Truncates the skill body to
 * `MAX_INJECTED_CHARS` so we don't blow the context window.
 */
export function buildSkillSystemMessage(skill: SkillDefinition): string {
  const body =
    skill.promptTemplate.length > MAX_INJECTED_CHARS
      ? skill.promptTemplate.slice(0, MAX_INJECTED_CHARS) +
        "\n\n… (skill body truncated to 4 KB)"
      : skill.promptTemplate;

  return (
    `<skill name="${skill.name}" source="${skill.source}">\n` +
    body +
    "\n</skill>"
  );
}

/**
 * Top-level entry point for the middleware. Given the user's latest
 * message, loads all skills, runs the matcher, and returns the
 * system-message injection (if any) + the matched skill name for
 * the `X-AF-Skill-Matched` response header.
 *
 * Returns `null` when:
 *   - `skills.auto_match` is not enabled in policy
 *   - No skills are loaded
 *   - No skill matches the user's message
 */
export function autoMatchSkill(userMessage: string): {
  systemMessage: string;
  skillName: string;
  score: number;
} | null {
  const skills = loadAllSkills();
  const match = matchSkill(userMessage, skills);
  if (!match) return null;
  return {
    systemMessage: buildSkillSystemMessage(match.skill),
    skillName: match.skill.name,
    score: match.score,
  };
}
