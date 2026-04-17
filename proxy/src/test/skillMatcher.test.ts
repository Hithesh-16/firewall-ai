/**
 * Tests for Phase L.L1 — skill auto-match middleware.
 */

import assert from "node:assert";
import {
  buildSkillSystemMessage,
  matchSkill,
} from "../middleware/skillMatcher";
import type { SkillDefinition } from "../skills/skillTypes";

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: "test-skill",
    description: "A test skill for commit messages and git history",
    promptTemplate: "You are a commit message writer...",
    source: "bundled",
    filePath: "/fake/path/SKILL.md",
    ...overrides,
  };
}

// ── matchSkill ──────────────────────────────────────────────────

export function testMatchSkillFindsKeywordHits() {
  const skills = [
    makeSkill({
      name: "commit",
      description: "Generate commit messages from staged git changes",
      trigger: "commit message",
    }),
    makeSkill({
      name: "explain",
      description: "Explain code structure and architecture",
    }),
  ];
  const match = matchSkill("make me a commit message for my changes", skills);
  assert.ok(match, "Should find a match");
  assert.strictEqual(match!.skill.name, "commit");
  assert.ok(match!.score >= 2, "Should have at least 2 keyword hits");
  assert.ok(
    match!.matchedKeywords.includes("commit"),
    'Should include "commit" keyword',
  );
}

export function testMatchSkillReturnsNullWhenNoHits() {
  const skills = [
    makeSkill({
      name: "commit",
      description: "Generate commit messages from staged git changes",
    }),
  ];
  const match = matchSkill("What is the weather today?", skills);
  assert.strictEqual(match, null, "Should return null for unrelated prompt");
}

export function testMatchSkillReturnsNullForEmptyInput() {
  const skills = [makeSkill()];
  assert.strictEqual(matchSkill("", skills), null);
}

export function testMatchSkillReturnsNullForEmptySkills() {
  assert.strictEqual(matchSkill("make a commit", []), null);
}

export function testMatchSkillPicksBestMatch() {
  const skills = [
    makeSkill({
      name: "commit",
      description: "Generate commit messages from staged git changes",
      trigger: "commit message staged",
    }),
    makeSkill({
      name: "explain",
      description: "Explain code",
    }),
  ];
  // "commit" and "message" and "staged" and "changes" should give commit a higher score
  const match = matchSkill(
    "generate a commit message for my staged changes",
    skills,
  );
  assert.ok(match);
  assert.strictEqual(match!.skill.name, "commit");
}

// ── buildSkillSystemMessage ─────────────────────────────────────

export function testBuildSkillSystemMessageWrapsInXML() {
  const skill = makeSkill({ name: "commit", source: "bundled" });
  const msg = buildSkillSystemMessage(skill);
  assert.ok(msg.startsWith('<skill name="commit" source="bundled">'));
  assert.ok(msg.endsWith("</skill>"));
  assert.ok(msg.includes(skill.promptTemplate));
}

export function testBuildSkillSystemMessageTruncatesLongBody() {
  const longBody = "x".repeat(5000);
  const skill = makeSkill({ promptTemplate: longBody });
  const msg = buildSkillSystemMessage(skill);
  assert.ok(msg.includes("truncated to 4 KB"));
  assert.ok(msg.length < 5000);
}
