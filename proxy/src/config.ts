import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { PolicyConfig } from "./types";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  PROVIDER_URL: z
    .string()
    .url()
    .default("https://api.openai.com/v1/chat/completions"),
  OPENAI_API_KEY: z.string().optional(),
  DB_PATH: z.string().default("./data/firewall.db"),
  DB_TYPE: z.enum(["sqlite", "postgres"]).default("sqlite"),
  DATABASE_URL: z.string().optional(), // PostgreSQL connection string
  MASTER_KEY: z.string().min(1).optional(),
  MASTER_KEY_V2: z.string().min(1).optional(), // Rotation target key
  STRICT_LOCAL: z.coerce.boolean().default(false),
  CORS_ORIGINS: z.string().optional(),
  SCIM_TOKEN: z.string().optional(), // SCIM provisioning bearer token
});

const parsedEnv = envSchema.safeParse(process.env);
if (!parsedEnv.success) {
  throw new Error(
    `Invalid environment configuration: ${parsedEnv.error.message}`,
  );
}

export const env = parsedEnv.data;

const POLICY_PATH = path.resolve(process.cwd(), "policy.json");

export function loadPolicyConfig(): PolicyConfig {
  const raw = fs.readFileSync(POLICY_PATH, "utf-8");
  const parsed = JSON.parse(raw) as PolicyConfig;
  return parsed;
}

/**
 * Resolve the effective policy for a Fastify request.
 *
 * When the request carries a valid bearer token (set by `optionalAuth`
 * or `requireAuth` middleware), the policy is resolved through the full
 * inheritance chain: global → org → **role** → team → project. This
 * ensures that role-level overrides (e.g. `blocked_paths` set on the
 * Developer role in the RBAC page) are respected by every scanning
 * endpoint — not just `/v1/chat/completions`.
 *
 * When no auth context is present (e.g. the core engine's
 * `fileScanProxy.ts` calls `/api/scan/file` without a token), falls
 * back to the global `policy.json` baseline so the system still works.
 *
 * @param authContext — from `request.authContext` (may be undefined)
 * @param projectRoot — workspace root for .aifirewall.json merge
 */
export function resolveRequestPolicy(
  authContext:
    | { user: { orgId: number | null; role?: string | null } }
    | undefined,
  projectRoot?: string,
): PolicyConfig {
  if (authContext?.user) {
    // Lazy import to avoid circular dependency (policyChain imports config)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolveEffectivePolicy } = require("./policy/policyChain");
    return resolveEffectivePolicy(
      authContext.user.orgId,
      authContext.user.role ?? null,
      null, // teamId — not on auth context today
      projectRoot,
    );
  }
  const global = loadPolicyConfig();
  if (projectRoot) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { mergeProjectPolicy } = require("./policy/projectPolicy");
    return mergeProjectPolicy(global, projectRoot);
  }
  return global;
}

export function isStrictLocal(): boolean {
  if (env.STRICT_LOCAL) return true;
  try {
    const policy = loadPolicyConfig();
    return !!policy.strict_local;
  } catch {
    return false;
  }
}

export function savePolicyConfig(policy: PolicyConfig): void {
  fs.writeFileSync(POLICY_PATH, JSON.stringify(policy, null, 2));
}

export const policyPath = POLICY_PATH;
