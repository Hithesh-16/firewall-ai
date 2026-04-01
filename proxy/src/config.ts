import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import { PolicyConfig } from "./types";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  PROVIDER_URL: z.string().url().default("https://api.openai.com/v1/chat/completions"),
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
  throw new Error(`Invalid environment configuration: ${parsedEnv.error.message}`);
}

export const env = parsedEnv.data;

const POLICY_PATH = path.resolve(process.cwd(), "policy.json");

export function loadPolicyConfig(): PolicyConfig {
  const raw = fs.readFileSync(POLICY_PATH, "utf-8");
  const parsed = JSON.parse(raw) as PolicyConfig;
  return parsed;
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
