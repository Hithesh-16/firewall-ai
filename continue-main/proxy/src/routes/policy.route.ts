import { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadPolicyConfig, savePolicyConfig } from "../config";

const updatePolicySchema = z.object({
  version: z.string(),
  rules: z.object({
    block_private_keys: z.boolean(),
    block_aws_keys: z.boolean(),
    block_db_urls: z.boolean(),
    block_github_tokens: z.boolean(),
    redact_emails: z.boolean(),
    redact_phone: z.boolean(),
    redact_jwt: z.boolean(),
    redact_generic_api_keys: z.boolean(),
    allow_source_code: z.boolean(),
    log_all_requests: z.boolean()
  }),
  file_scope: z.object({
    mode: z.enum(["blocklist", "allowlist"]),
    blocklist: z.array(z.string()),
    allowlist: z.array(z.string()),
    max_file_size_kb: z.number(),
    scan_on_open: z.boolean(),
    scan_on_send: z.boolean()
  }),
  blocked_paths: z.array(z.string()),
  severity_threshold: z.enum(["critical", "high", "medium"])
});

const updateScopeSchema = z.object({
  mode: z.enum(["blocklist", "allowlist"]),
  blocklist: z.array(z.string()),
  allowlist: z.array(z.string()),
  max_file_size_kb: z.number(),
  scan_on_open: z.boolean(),
  scan_on_send: z.boolean()
});

/** Default sensitive file/folder patterns for auto-detection */
const DEFAULT_SENSITIVE_PATTERNS: Array<{ pattern: string; category: string; description: string }> = [
  { pattern: ".env", category: "secrets", description: "Environment variables (may contain API keys)" },
  { pattern: ".env.*", category: "secrets", description: "Environment overrides" },
  { pattern: "**/*.pem", category: "certificates", description: "PEM certificate files" },
  { pattern: "**/*.key", category: "certificates", description: "Private key files" },
  { pattern: "**/*.p12", category: "certificates", description: "PKCS#12 certificate bundles" },
  { pattern: "**/*.pfx", category: "certificates", description: "PFX certificate files" },
  { pattern: "**/secrets/**", category: "secrets", description: "Secrets directory" },
  { pattern: "**/credentials/**", category: "secrets", description: "Credentials directory" },
  { pattern: "**/.ssh/**", category: "secrets", description: "SSH keys and config" },
  { pattern: "**/config/production.*", category: "config", description: "Production configuration" },
  { pattern: "**/.git/**", category: "internal", description: "Git internals" },
  { pattern: "**/node_modules/**", category: "dependencies", description: "Node.js dependencies" },
  { pattern: "**/dist/**", category: "build", description: "Build output" },
  { pattern: "**/.aifirewall-vault/**", category: "secrets", description: "AI Firewall vault data" },
  { pattern: "**/docker-compose*.yml", category: "config", description: "Docker Compose (may contain secrets)" },
  { pattern: "**/*.env.local", category: "secrets", description: "Local environment overrides" },
  { pattern: "**/id_rsa*", category: "certificates", description: "RSA private keys" },
  { pattern: "**/serviceAccount*.json", category: "secrets", description: "Service account credentials" },
];

export async function registerPolicyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/policy", async () => loadPolicyConfig());

  app.put("/api/policy", async (request, reply) => {
    const parsed = updatePolicySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid policy payload",
        details: parsed.error.flatten()
      });
    }
    savePolicyConfig(parsed.data);
    return { ok: true, policy: parsed.data };
  });

  // Hot-reload policy (for any client to trigger after writing .aifirewall.json)
  app.post("/api/policy/reload", async () => {
    const policy = loadPolicyConfig();
    return { ok: true, policy };
  });

  app.get("/api/file-scope", async () => {
    const policy = loadPolicyConfig();
    return { file_scope: policy.file_scope };
  });

  app.put("/api/file-scope", async (request, reply) => {
    const parsed = updateScopeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid file scope payload",
        details: parsed.error.flatten()
      });
    }
    const policy = loadPolicyConfig();
    policy.file_scope = parsed.data;
    savePolicyConfig(policy);
    return { ok: true, file_scope: policy.file_scope };
  });

  // ── Security Perimeter APIs (client-agnostic) ──

  /**
   * GET /api/perimeter/detect
   * Returns auto-detected sensitive file patterns for a workspace.
   * Any client (VS Code, CLI, JetBrains, browser) can call this.
   */
  app.get("/api/perimeter/detect", async (request) => {
    const query = request.query as { projectRoot?: string };
    const policy = loadPolicyConfig();
    const currentBlocklist = policy.file_scope?.blocklist ?? [];

    return {
      patterns: DEFAULT_SENSITIVE_PATTERNS.map((p) => ({
        ...p,
        recommended: true,
        active: currentBlocklist.includes(p.pattern),
      })),
      currentBlocklist,
    };
  });

  /**
   * POST /api/perimeter/confirm
   * Saves the user's file restriction choices to the proxy policy.
   * Any client can call this to set the security perimeter.
   */
  const confirmPerimeterSchema = z.object({
    restricted: z.array(z.string()),
    projectRoot: z.string().optional(),
  });

  app.post("/api/perimeter/confirm", async (request, reply) => {
    const parsed = confirmPerimeterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid perimeter payload",
        details: parsed.error.flatten(),
      });
    }

    const { restricted } = parsed.data;
    const policy = loadPolicyConfig();
    policy.file_scope.blocklist = restricted;
    savePolicyConfig(policy);

    return {
      ok: true,
      file_scope: policy.file_scope,
      restricted_count: restricted.length,
    };
  });

  /**
   * GET /api/perimeter/status
   * Returns current perimeter state so any client can check setup status.
   */
  app.get("/api/perimeter/status", async () => {
    const policy = loadPolicyConfig();
    const blocklist = policy.file_scope?.blocklist ?? [];
    return {
      configured: blocklist.length > 0,
      restricted_count: blocklist.length,
      blocklist,
      mode: policy.file_scope?.mode ?? "blocklist",
    };
  });
}
