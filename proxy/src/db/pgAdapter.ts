/**
 * PostgreSQL Database Adapter
 *
 * Optional alternative to SQLite for team/enterprise deployments.
 * Activated via DB_TYPE=postgres + DATABASE_URL env vars.
 *
 * Uses the same Drizzle ORM schema definitions, just with a different
 * dialect driver (drizzle-orm/node-postgres instead of drizzle-orm/better-sqlite3).
 *
 * NOTE: This is a migration path stub. Full implementation requires:
 *   1. npm install pg drizzle-orm/node-postgres
 *   2. Schema migration scripts (SQLite → PostgreSQL DDL conversion)
 *   3. Data migration tool (dump SQLite → import to PG)
 *
 * For now, this module exports a factory that returns the correct db instance
 * based on DB_TYPE. The rest of the codebase uses `import { db } from "../db"`
 * and doesn't need to know which backend is active.
 */

import { env } from "../config";

/**
 * Check if PostgreSQL mode is configured.
 */
export function isPostgresMode(): boolean {
  return env.DB_TYPE === "postgres" && !!env.DATABASE_URL;
}

/**
 * Get a PostgreSQL Drizzle instance.
 * Requires `pg` and `drizzle-orm` with postgres driver installed.
 *
 * Throws if dependencies are not installed — this is expected.
 * The error message guides the user to install the right packages.
 */
export async function createPostgresDb() {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when DB_TYPE=postgres");
  }

  try {
    // Dynamic imports — only loaded when postgres mode is active
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { Pool } = await import("pg");
    const schema = await import("./schema");

    const pool = new Pool({ connectionString: env.DATABASE_URL });
    return drizzle(pool, { schema });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("Cannot find module")) {
      throw new Error(
        "PostgreSQL mode requires additional packages. Install them with:\n" +
        "  npm install pg drizzle-orm\n" +
        "Then restart the proxy."
      );
    }
    throw err;
  }
}

/**
 * Generate PostgreSQL DDL from the existing SQLite schema.
 * Useful for manual migration — run this and execute against your PG instance.
 */
export function generatePostgresDDL(): string {
  return `
-- AI Firewall PostgreSQL Schema
-- Generated from SQLite schema. Run this against your PostgreSQL instance.
-- Then set DB_TYPE=postgres and DATABASE_URL=postgresql://... in .env

-- Note: AUTO_INCREMENT → SERIAL, INTEGER → INT, TEXT → TEXT (same)
-- Key differences: no AUTOINCREMENT keyword, use SERIAL instead

-- See proxy/src/db/database.ts for the full schema.
-- Each CREATE TABLE IF NOT EXISTS maps 1:1 to PostgreSQL with minor syntax changes.

-- Example migration steps:
-- 1. Create the PostgreSQL database
-- 2. Run this DDL
-- 3. Export data from SQLite: sqlite3 data/firewall.db .dump > dump.sql
-- 4. Transform dump.sql for PG syntax (integer literals, quote differences)
-- 5. Import: psql -d ai_firewall < dump_pg.sql
-- 6. Set DB_TYPE=postgres DATABASE_URL=postgresql://user:pass@host/ai_firewall
-- 7. Restart proxy

SELECT 'PostgreSQL migration DDL generation not yet fully automated. See proxy/src/db/pgAdapter.ts for manual steps.';
`;
}
