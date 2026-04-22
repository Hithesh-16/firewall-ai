/**
 * Dev-only: wipe ALL user-scoped data from the proxy DB so you can
 * start testing from a clean slate.
 *
 * Usage (from the proxy/ directory):
 *
 *   npx ts-node scripts/reset-dev-db.ts
 *
 * What it deletes (everything user-identity-bound):
 *   - users, organizations, user_org_roles, user_team_roles, teams
 *   - api_tokens
 *   - providers, user_providers, org_providers
 *   - user_models
 *   - model_grants
 *   - org_rules, org_skills, user_rule_subscriptions, user_skill_subscriptions
 *   - logs, usage_logs, credits_ledger, approvals
 *   - the (now-retired) `assistants` table if it still exists
 *
 * What it KEEPS:
 *   - Schema (`CREATE TABLE` definitions survive — only rows go)
 *   - `settings` KV rows (feature flags, migrations-completed markers)
 *   - `roles` + `capabilities` + `role_capabilities` (system RBAC — re-seeded on next boot if missing)
 *
 * Also wipes `~/.ai-firewall/auth.json`, `~/.ai-firewall/config.yaml`,
 * `~/.ai-firewall/rules/`, `~/.ai-firewall/skills/`, `~/.ai-firewall/cache/`,
 * `~/.ai-firewall/sessions/` via the shared `clearUserArtefacts` helper
 * so the IDE/CLI on the same machine see a clean filesystem too.
 *
 * Safety: refuses to run if NODE_ENV=production. Prints a big banner
 * + 3-second countdown before destroying anything.
 */

/* eslint-disable no-console */
import { clearUserArtefacts } from "@ai-firewall/shared-auth";

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("✗ Refusing to run reset-dev-db.ts in production.");
    process.exit(1);
  }

  console.warn(
    "\n╭───────────────────────────────────────────────────────────╮",
  );
  console.warn("│  RESET — wiping ALL users, orgs, providers, models,       │");
  console.warn("│  grants, tokens, logs, rules, skills, subscriptions.      │");
  console.warn("│  Schema + system roles + capabilities are preserved.      │");
  console.warn("╰───────────────────────────────────────────────────────────╯");
  for (let i = 3; i > 0; i--) {
    process.stdout.write(`  starting in ${i}...\r`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  process.stdout.write("  starting...      \n");

  // Load after the countdown so the DB doesn't auto-init before
  // we're ready (the module runs migrations on import).
  const { default: db } = await import("../src/db/database");

  const TABLES = [
    "api_tokens",
    "user_org_roles",
    "user_team_roles",
    "teams",
    "user_rule_subscriptions",
    "user_skill_subscriptions",
    "org_rules",
    "org_skills",
    "model_grants",
    "user_models",
    "user_providers",
    "org_providers",
    "providers",
    "logs",
    "usage_logs",
    "credits_ledger",
    "approvals",
    "invites",
    "users",
    "organizations",
  ];

  // One TX so either everything clears or nothing does.
  const wipe = db.transaction(() => {
    for (const t of TABLES) {
      try {
        db.prepare(`DELETE FROM ${t}`).run();
        console.log(`  ✓ cleared ${t}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("no such table")) {
          console.log(`  — skipped ${t} (no such table)`);
        } else {
          console.warn(`  ! ${t}: ${msg}`);
        }
      }
    }
    // Drop the retired `assistants` table outright if it still
    // exists (fresh-installs never create it anyway).
    try {
      db.exec("DROP TABLE IF EXISTS assistants");
    } catch {
      /* ignore */
    }
  });
  wipe();

  try {
    clearUserArtefacts();
    console.log("  ✓ cleared ~/.ai-firewall/ user-identity files");
  } catch (e) {
    console.warn(
      `  ! clearUserArtefacts: ${e instanceof Error ? e.message : e}`,
    );
  }

  console.log(
    "\n✓ Reset complete. You can now register a new admin via the web sign-up flow.",
  );
  process.exit(0);
}

void main().catch((e) => {
  console.error("✗ reset-dev-db failed:", e);
  process.exit(1);
});
