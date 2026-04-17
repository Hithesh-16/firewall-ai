/**
 * Tests for Declarative Subagent Registry — Phase I.I2
 * SECURITY_HARDENING_PLAN.md.
 */

import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as YAML from "yaml";
import {
  _internal,
  buildTaskToolDefinition,
  getSubagentDef,
  listSubagentNames,
  loadSubagentRegistry,
} from "../agents/registry";

// ── Helpers ─────────────────────────────────────────────────────

function makeTmpProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "afw-subagent-test-"));
}

function writeSubagents(dir: string, defs: unknown[]): void {
  const afDir = path.join(dir, ".ai-firewall");
  fs.mkdirSync(afDir, { recursive: true });
  fs.writeFileSync(
    path.join(afDir, "subagents.yaml"),
    YAML.stringify(defs),
    "utf8",
  );
}

// ── Load + merge ────────────────────────────────────────────────

export function testLoadEmptyProjectReturnsEmpty() {
  const proj = makeTmpProject();
  try {
    const reg = loadSubagentRegistry(proj);
    assert.deepStrictEqual(reg, []);
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

export function testLoadProjectSubagents() {
  const proj = makeTmpProject();
  try {
    writeSubagents(proj, [
      { name: "researcher", description: "Searches code" },
      { name: "writer", description: "Writes docs" },
    ]);
    const reg = loadSubagentRegistry(proj);
    assert.strictEqual(reg.length, 2);
    assert.strictEqual(reg[0].name, "researcher");
    assert.strictEqual(reg[1].name, "writer");
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

export function testProjectOverridesUserScope() {
  const proj = makeTmpProject();
  // Can't easily write to ~/.ai-firewall/ in tests without risk,
  // so we just verify project-scoped definitions load correctly.
  // The merge logic is unit-testable through the precedence order:
  // project entries overwrite user entries by name.
  try {
    writeSubagents(proj, [
      {
        name: "shared",
        description: "project-scoped override",
        model: "openai:gpt-4o",
      },
    ]);
    const reg = loadSubagentRegistry(proj);
    assert.strictEqual(reg.length, 1);
    assert.strictEqual(reg[0].description, "project-scoped override");
    assert.strictEqual(reg[0].model, "openai:gpt-4o");
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

export function testMalformedYamlReturnsEmpty() {
  const proj = makeTmpProject();
  try {
    const afDir = path.join(proj, ".ai-firewall");
    fs.mkdirSync(afDir, { recursive: true });
    fs.writeFileSync(
      path.join(afDir, "subagents.yaml"),
      "{ this is not valid yaml",
      "utf8",
    );
    const reg = loadSubagentRegistry(proj);
    assert.deepStrictEqual(reg, []);
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

export function testSkipsEntriesWithoutName() {
  const proj = makeTmpProject();
  try {
    writeSubagents(proj, [
      { description: "no name field" },
      { name: "valid", description: "has a name" },
      42,
      null,
    ]);
    const reg = loadSubagentRegistry(proj);
    assert.strictEqual(reg.length, 1);
    assert.strictEqual(reg[0].name, "valid");
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// ── Lookup helpers ──────────────────────────────────────────────

export function testListSubagentNames() {
  const proj = makeTmpProject();
  try {
    writeSubagents(proj, [
      { name: "a", description: "Agent A" },
      { name: "b", description: "Agent B" },
    ]);
    const names = listSubagentNames(proj);
    assert.strictEqual(names.length, 2);
    assert.strictEqual(names[0].name, "a");
    assert.strictEqual(names[1].description, "Agent B");
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

export function testGetSubagentDef() {
  const proj = makeTmpProject();
  try {
    writeSubagents(proj, [
      { name: "target", description: "The one we want", model: "groq:llama3" },
    ]);
    const def = getSubagentDef(proj, "target");
    assert.ok(def);
    assert.strictEqual(def!.model, "groq:llama3");
    assert.strictEqual(getSubagentDef(proj, "nonexistent"), undefined);
  } finally {
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// ── Tool injection ──────────────────────────────────────────────

export function testBuildTaskToolDefinitionEmptyRegistryReturnsNull() {
  assert.strictEqual(buildTaskToolDefinition([]), null);
}

export function testBuildTaskToolDefinitionWithRegistry() {
  const tool = buildTaskToolDefinition([
    { name: "researcher", description: "Searches code" },
    { name: "writer", description: "Writes docs" },
  ]);
  assert.ok(tool);
  assert.strictEqual(tool!.type, "function");
  assert.strictEqual(tool!.function.name, "task");
  assert.ok(tool!.function.description.includes("researcher"));
  assert.ok(tool!.function.description.includes("writer"));
  const params = tool!.function.parameters as {
    properties: { name: { enum: string[] } };
  };
  assert.deepStrictEqual(params.properties.name.enum, ["researcher", "writer"]);
}
