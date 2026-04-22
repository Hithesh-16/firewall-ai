/**
 * Key Migration Service — Phase C follow-up.
 *
 * Migrates plaintext `apiKey:` entries in a `config.yaml` to
 * vault-backed `apiKeyRef: vault://<slug>` references.
 *
 * Flow:
 *   1. Read the YAML file
 *   2. For each model with a raw `apiKey:` value:
 *      a. POST the key to `/api/providers` (or the in-process DB
 *         equivalent) to vault it
 *      b. Replace the `apiKey:` field with `apiKeyRef: vault://<slug>`
 *      c. Remove the raw `apiKey:` field
 *   3. Write the updated YAML back to disk
 *
 * Designed to be called from:
 *   - The `/migrate-keys` slash command (user-initiated)
 *   - The C6 hard-refusal recovery path (auto-migrate instead of crash)
 *   - A one-shot CLI script for existing installs
 */

import * as fs from "node:fs";
import * as YAML from "yaml";
import { asc } from "drizzle-orm";
import { createProvider, getProviderBySlug } from "../gateway/providerService";
import { db } from "../db/index";
import { organizations } from "../db/schema";

/**
 * Resolve the "system" org used by the startup YAML → vault migration.
 *
 * Why: the migration runs without an authenticated user, but providers
 * are now strictly org-scoped (ux_providers_org_slug). We attach
 * migrated rows to the oldest org — the same rule used by the
 * database.ts backfill, so a freshly-installed instance stays
 * consistent with pre-migration data.
 */
function getSystemOrgId(): number | null {
  const row = db
    .select({ id: organizations.id })
    .from(organizations)
    .orderBy(asc(organizations.createdAt), asc(organizations.id))
    .limit(1)
    .get();
  return row?.id ?? null;
}

// ── Types ───────────────────────────────────────────────────────

export interface MigrationResult {
  readonly migrated: number;
  readonly skipped: number;
  readonly errors: string[];
  readonly details: Array<{
    modelName: string;
    provider: string;
    slug: string;
    action: "migrated" | "skipped" | "error";
    reason?: string;
  }>;
}

// ── Migration ───────────────────────────────────────────────────

/**
 * Migrate all plaintext `apiKey:` entries in a config.yaml to
 * vault-backed `apiKeyRef:` references.
 *
 * Safe to call multiple times — already-migrated entries (those
 * with `apiKeyRef:` and no `apiKey:`) are skipped. Existing vault
 * entries are reused (not duplicated).
 */
export function migrateConfigKeys(configPath: string): MigrationResult {
  if (!fs.existsSync(configPath)) {
    return {
      migrated: 0,
      skipped: 0,
      errors: [`Config file not found: ${configPath}`],
      details: [],
    };
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const doc = YAML.parseDocument(raw);
  const modelsNode = doc.get("models");

  if (!YAML.isSeq(modelsNode)) {
    return {
      migrated: 0,
      skipped: 0,
      errors: ["No 'models' array found in config.yaml"],
      details: [],
    };
  }

  // Resolve the org that will own migrated providers. No orgs → nothing
  // to migrate yet (fresh install, onboarding has not run).
  const systemOrgId = getSystemOrgId();
  if (systemOrgId == null) {
    return {
      migrated: 0,
      skipped: 0,
      errors: ["No organizations exist; cannot vault keys yet"],
      details: [],
    };
  }

  let migrated = 0;
  let skipped = 0;
  const errors: string[] = [];
  const details: MigrationResult["details"] = [];

  for (let i = 0; i < modelsNode.items.length; i++) {
    const item = modelsNode.items[i];
    if (!YAML.isMap(item)) continue;

    const nameNode = item.get("name");
    const providerNode = item.get("provider");
    const apiKeyNode = item.get("apiKey");
    const apiKeyRefNode = item.get("apiKeyRef");
    const apiBaseNode = item.get("apiBase");

    const modelName = String(nameNode ?? `model-${i}`);
    const provider = String(providerNode ?? "unknown");

    // Already migrated
    if (apiKeyRefNode && !apiKeyNode) {
      skipped += 1;
      details.push({
        modelName,
        provider,
        slug: provider,
        action: "skipped",
        reason: "already has apiKeyRef, no raw apiKey",
      });
      continue;
    }

    // No key at all (Ollama-style local provider)
    if (!apiKeyNode) {
      skipped += 1;
      details.push({
        modelName,
        provider,
        slug: provider,
        action: "skipped",
        reason: "no apiKey field (local provider)",
      });
      continue;
    }

    const apiKey = String(apiKeyNode);

    // Template / vault reference — skip
    if (
      apiKey.startsWith("vault://") ||
      apiKey.startsWith("${{") ||
      apiKey.startsWith("${")
    ) {
      skipped += 1;
      details.push({
        modelName,
        provider,
        slug: provider,
        action: "skipped",
        reason: `apiKey is already indirect: ${apiKey.slice(0, 20)}...`,
      });
      continue;
    }

    // Vault the key
    const slug = provider;
    try {
      // Check if already vaulted under this slug (within the system org)
      const existing = getProviderBySlug(slug, systemOrgId);
      if (!existing) {
        const baseUrl = apiBaseNode ? String(apiBaseNode) : "";
        createProvider(provider, apiKey, baseUrl, systemOrgId);
      }
      // else: slug already exists in vault — reuse it. The key may
      // differ (user rotated), but for migration we keep the first
      // one and the user can rotate via PUT /api/me/providers/:slug.

      // Rewrite the YAML node: remove apiKey, add apiKeyRef
      item.delete("apiKey");
      item.set("apiKeyRef", `vault://${slug}`);

      migrated += 1;
      details.push({
        modelName,
        provider,
        slug,
        action: "migrated",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // If it's a UNIQUE constraint (provider already exists), still
      // migrate the YAML — the key is already in the vault.
      if (msg.includes("UNIQUE constraint")) {
        item.delete("apiKey");
        item.set("apiKeyRef", `vault://${slug}`);
        migrated += 1;
        details.push({
          modelName,
          provider,
          slug,
          action: "migrated",
          reason: "provider already in vault (reused)",
        });
      } else {
        errors.push(`Failed to vault key for ${modelName}: ${msg}`);
        details.push({
          modelName,
          provider,
          slug,
          action: "error",
          reason: msg,
        });
      }
    }
  }

  // Write back
  if (migrated > 0) {
    fs.writeFileSync(configPath, doc.toString(), "utf8");
  }

  return { migrated, skipped, errors, details };
}
