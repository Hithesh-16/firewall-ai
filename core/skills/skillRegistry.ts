/**
 * Skill Registry
 *
 * Trigger matching for SKILL.md files. Builds on the existing
 * loadMarkdownSkills.ts loader — adds keyword-based trigger matching
 * and priority-ranked retrieval.
 *
 * Algorithm: keyword overlap (not semantic embeddings — too slow for per-request).
 * Score = matched_triggers / total_triggers. Rank descending, take top N.
 *
 * SOLID:
 * - SRP: Only matches queries to skills. No loading, no injection.
 * - OCP: New matching strategies via MatchAlgorithm type.
 */

import type { Skill } from "../";

export interface SkillRecord {
  name: string;
  description: string;
  content: string;
  path: string;
  /** Keywords that trigger this skill */
  triggers: string[];
  /** Priority 1-10 (higher = more important, default 5) */
  priority: number;
  /** Max tokens this skill may consume (optional per-skill override) */
  maxTokens?: number;
}

export interface SkillMatch {
  skill: SkillRecord;
  score: number;
  matchedTriggers: string[];
}

/**
 * Convert a Skill (from loadMarkdownSkills) to a SkillRecord.
 * Extracts triggers and priority from frontmatter if present,
 * falls back to name-based triggers.
 */
export function skillToRecord(skill: Skill & {
  triggers?: string[];
  priority?: number;
  maxTokens?: number;
}): SkillRecord {
  return {
    name: skill.name,
    description: skill.description,
    content: skill.content,
    path: skill.path ?? "",
    triggers: skill.triggers ?? skill.name.toLowerCase().split(/[\s-_]+/),
    priority: skill.priority ?? 5,
    maxTokens: skill.maxTokens,
  };
}

/**
 * Match a user message against skill triggers.
 *
 * Score = matched_triggers / total_triggers (0 to 1).
 * Returns skills sorted by score descending, then priority descending.
 *
 * @param query - User message text
 * @param skills - Available skill records
 * @param topN - Max skills to return (default: 3)
 * @param minScore - Minimum match score to include (default: 0.3)
 */
export function matchSkills(
  query: string,
  skills: SkillRecord[],
  topN = 3,
  minScore = 0.3,
): SkillMatch[] {
  const queryLower = query.toLowerCase();
  const queryWords = new Set(queryLower.split(/\W+/).filter((w) => w.length > 2));

  const matches: SkillMatch[] = [];

  for (const skill of skills) {
    if (skill.triggers.length === 0) continue;

    const matchedTriggers = skill.triggers.filter((trigger) => {
      const triggerLower = trigger.toLowerCase();
      // Check if trigger word appears in query
      return queryWords.has(triggerLower) || queryLower.includes(triggerLower);
    });

    const score = matchedTriggers.length / skill.triggers.length;

    if (score >= minScore) {
      matches.push({ skill, score, matchedTriggers });
    }
  }

  // Sort by score descending, then priority descending
  return matches
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.skill.priority - a.skill.priority;
    })
    .slice(0, topN);
}
