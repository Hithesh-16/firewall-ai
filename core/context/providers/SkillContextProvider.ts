import { BaseContextProvider } from "../";
import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
} from "../../";
import { loadMarkdownSkills } from "../../config/markdown/loadMarkdownSkills";
import { matchSkills, skillToRecord, type SkillRecord } from "../../skills/skillRegistry";

/** Max total characters for injected skills (default ~1000 tokens) */
const DEFAULT_SKILL_BUDGET_CHARS = 4000;

class SkillContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "skills",
    displayTitle: "Skills",
    description: "Auto-inject relevant .ai-firewall/skills based on message content",
    type: "normal",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    try {
      const { skills } = await loadMarkdownSkills(extras.ide);

      if (skills.length === 0) {
        return [];
      }

      // Convert loaded skills to registry records
      const records: SkillRecord[] = skills.map((s) =>
        skillToRecord(s as any),
      );

      // Match against user query
      const matched = matchSkills(query, records);

      if (matched.length === 0) {
        return [];
      }

      // Token-budgeted injection: include skills until budget exceeded
      // Never truncate a skill mid-content — include fully or exclude entirely
      const budget = DEFAULT_SKILL_BUDGET_CHARS;
      let usedChars = 0;
      const included: ContextItem[] = [];

      // Sort by priority descending for budget allocation
      const byPriority = [...matched].sort(
        (a, b) => b.skill.priority - a.skill.priority,
      );

      for (const match of byPriority) {
        const skillChars = match.skill.content.length;

        if (usedChars + skillChars > budget) {
          // Skip this skill — would exceed budget
          continue;
        }

        usedChars += skillChars;
        included.push({
          name: `Skill: ${match.skill.name}`,
          description: `${match.skill.description} (score: ${match.score.toFixed(2)}, triggers: ${match.matchedTriggers.join(", ")})`,
          content: match.skill.content,
        });
      }

      return included;
    } catch {
      // Skill loading failure should never break the session
      return [];
    }
  }
}

export default SkillContextProvider;
