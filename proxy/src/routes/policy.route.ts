import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole, requireCapability } from "../auth/authMiddleware";
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
  app.get("/api/policy", { preHandler: requireAuth }, async () => loadPolicyConfig());

  app.put("/api/policy", { preHandler: requireRole("admin", "security_lead") }, async (request, reply) => {
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
  app.post("/api/policy/reload", { preHandler: requireAuth }, async () => {
    const policy = loadPolicyConfig();
    return { ok: true, policy };
  });

  app.get("/api/file-scope", { preHandler: requireAuth }, async () => {
    const policy = loadPolicyConfig();
    return { file_scope: policy.file_scope };
  });

  app.put("/api/file-scope", { preHandler: requireRole("admin", "security_lead") }, async (request, reply) => {
    const parsed = updateScopeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid file scope payload",
        details: parsed.error.flatten()
      });
    }
    const policy = loadPolicyConfig();
    const updated = { ...policy, file_scope: parsed.data };
    savePolicyConfig(updated);
    return { ok: true, file_scope: updated.file_scope };
  });

  // ── Security Perimeter APIs (client-agnostic) ──

  /**
   * GET /api/perimeter/detect
   * Returns auto-detected sensitive file patterns for a workspace.
   * Any client (VS Code, CLI, JetBrains, browser) can call this.
   */
  app.get("/api/perimeter/detect", { preHandler: requireAuth }, async (request) => {
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

  app.post("/api/perimeter/confirm", { preHandler: requireRole("admin", "security_lead") }, async (request, reply) => {
    const parsed = confirmPerimeterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid perimeter payload",
        details: parsed.error.flatten(),
      });
    }

    const { restricted } = parsed.data;
    const policy = loadPolicyConfig();
    const updatedFileScope = { ...policy.file_scope, blocklist: restricted };
    const updated = { ...policy, file_scope: updatedFileScope };
    savePolicyConfig(updated);

    return {
      ok: true,
      file_scope: updated.file_scope,
      restricted_count: restricted.length,
    };
  });

  /**
   * GET /api/perimeter/status
   * Returns current perimeter state so any client can check setup status.
   */
  app.get("/api/perimeter/status", { preHandler: requireAuth }, async () => {
    const policy = loadPolicyConfig();
    const blocklist = policy.file_scope?.blocklist ?? [];
    return {
      configured: blocklist.length > 0,
      restricted_count: blocklist.length,
      blocklist,
      mode: policy.file_scope?.mode ?? "blocklist",
    };
  });

  // ── Per-Org/Team/User File Restriction APIs ──

  const fileRestrictionSchema = z.object({
    mode: z.enum(["blocklist", "allowlist"]),
    patterns: z.array(z.string()),
  });

  /**
   * GET /api/file-restrictions
   * Returns effective merged file policy for the authenticated user.
   */
  app.get("/api/file-restrictions", { preHandler: requireAuth }, async (request, reply) => {
    const { getEffectiveFilePolicy } = await import("../policy/fileRestrictionService");
    const user = request.authContext?.user;
    if (!user?.orgId) {
      return reply.status(400).send({ error: "User has no organization" });
    }
    return getEffectiveFilePolicy(user.orgId, null, user.id);
  });

  /**
   * GET /api/file-restrictions/all
   * Lists all file restrictions for the org (admin view).
   */
  app.get("/api/file-restrictions/all", { preHandler: [requireAuth, requireCapability("file_restrictions:manage")] }, async (request, reply) => {
    const { listFileRestrictions } = await import("../policy/fileRestrictionService");
    const orgId = request.authContext?.user.orgId;
    if (!orgId) return reply.status(400).send({ error: "User has no organization" });
    return { restrictions: listFileRestrictions(orgId) };
  });

  /**
   * PUT /api/file-restrictions/org
   * Set org-level file restriction (admin only).
   */
  app.put("/api/file-restrictions/org", { preHandler: [requireAuth, requireCapability("file_restrictions:manage")] }, async (request, reply) => {
    const { setFileRestriction } = await import("../policy/fileRestrictionService");
    const orgId = request.authContext?.user.orgId;
    if (!orgId) return reply.status(400).send({ error: "User has no organization" });

    const parsed = fileRestrictionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const result = setFileRestriction(orgId, null, null, parsed.data.mode, parsed.data.patterns);
    return { ok: true, restriction: result };
  });

  /**
   * PUT /api/file-restrictions/team/:teamId
   * Set team-level file restriction (admin, security_lead).
   */
  app.put("/api/file-restrictions/team/:teamId", { preHandler: [requireAuth, requireCapability("file_restrictions:manage")] }, async (request, reply) => {
    const { setFileRestriction } = await import("../policy/fileRestrictionService");
    const orgId = request.authContext?.user.orgId;
    if (!orgId) return reply.status(400).send({ error: "User has no organization" });

    const { teamId } = request.params as { teamId: string };
    const parsed = fileRestrictionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const result = setFileRestriction(orgId, Number(teamId), null, parsed.data.mode, parsed.data.patterns);
    return { ok: true, restriction: result };
  });

  /**
   * PUT /api/file-restrictions/user/:userId
   * Set user-level file restriction (admin only).
   */
  app.put("/api/file-restrictions/user/:userId", { preHandler: [requireAuth, requireCapability("file_restrictions:manage")] }, async (request, reply) => {
    const { setFileRestriction } = await import("../policy/fileRestrictionService");
    const orgId = request.authContext?.user.orgId;
    if (!orgId) return reply.status(400).send({ error: "User has no organization" });

    const { userId } = request.params as { userId: string };
    const parsed = fileRestrictionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const result = setFileRestriction(orgId, null, Number(userId), parsed.data.mode, parsed.data.patterns);
    return { ok: true, restriction: result };
  });

  /**
   * DELETE /api/file-restrictions/:id
   * Remove a file restriction (admin only).
   */
  app.delete("/api/file-restrictions/:id", { preHandler: [requireAuth, requireCapability("file_restrictions:manage")] }, async (request, reply) => {
    const { deleteFileRestriction } = await import("../policy/fileRestrictionService");
    const { id } = request.params as { id: string };
    const deleted = deleteFileRestriction(Number(id));
    if (!deleted) return reply.status(404).send({ error: "Restriction not found" });
    return { ok: true };
  });

  // ── Policy Inheritance Chain APIs ──

  const scopedPolicySchema = z.object({
    rules: z.object({
      block_private_keys: z.boolean().optional(),
      block_aws_keys: z.boolean().optional(),
      block_db_urls: z.boolean().optional(),
      block_github_tokens: z.boolean().optional(),
      redact_emails: z.boolean().optional(),
      redact_phone: z.boolean().optional(),
      redact_jwt: z.boolean().optional(),
      redact_generic_api_keys: z.boolean().optional(),
      allow_source_code: z.boolean().optional(),
      log_all_requests: z.boolean().optional(),
    }).optional(),
    file_scope: z.object({
      blocklist: z.array(z.string()).optional(),
      allowlist: z.array(z.string()).optional(),
    }).optional(),
    blocked_paths: z.array(z.string()).optional(),
    severity_threshold: z.enum(["medium", "high", "critical"]).optional(),
  });

  /**
   * GET /api/policies/effective
   * Returns the fully resolved policy for the authenticated user (global + org + team + project merged).
   */
  app.get("/api/policies/effective", { preHandler: requireAuth }, async (request, reply) => {
    const { resolveEffectivePolicy } = await import("../policy/policyChain");
    const user = request.authContext?.user;
    if (!user?.orgId) {
      return reply.status(400).send({ error: "User has no organization" });
    }
    const projectRoot = (request.query as Record<string, string>).projectRoot;
    return resolveEffectivePolicy(user.orgId, null, projectRoot);
  });

  /**
   * GET /api/policies/scoped
   * List all scoped policy overrides for the org (admin view).
   */
  app.get("/api/policies/scoped", { preHandler: [requireAuth, requireCapability("policy:read")] }, async (request, reply) => {
    const { listScopedPolicies } = await import("../policy/policyChain");
    const orgId = request.authContext?.user.orgId;
    if (!orgId) return reply.status(400).send({ error: "User has no organization" });
    return { policies: listScopedPolicies(orgId) };
  });

  /**
   * PUT /api/policies/org
   * Set org-level policy override (extends global, strictest wins).
   */
  app.put("/api/policies/org", { preHandler: [requireAuth, requireCapability("policy:write")] }, async (request, reply) => {
    const { saveScopedPolicy } = await import("../policy/policyChain");
    const orgId = request.authContext?.user.orgId;
    if (!orgId) return reply.status(400).send({ error: "User has no organization" });

    const parsed = scopedPolicySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    saveScopedPolicy("org", orgId, parsed.data as any);
    return { ok: true };
  });

  /**
   * PUT /api/policies/team/:teamId
   * Set team-level policy override.
   */
  app.put("/api/policies/team/:teamId", { preHandler: [requireAuth, requireCapability("policy:write")] }, async (request, reply) => {
    const { saveScopedPolicy } = await import("../policy/policyChain");
    const { teamId } = request.params as { teamId: string };

    const parsed = scopedPolicySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    saveScopedPolicy("team", Number(teamId), parsed.data as any);
    return { ok: true };
  });

  /**
   * DELETE /api/policies/org
   * Remove org-level policy override (revert to global).
   */
  app.delete("/api/policies/org", { preHandler: [requireAuth, requireCapability("policy:write")] }, async (request, reply) => {
    const { deleteScopedPolicy } = await import("../policy/policyChain");
    const orgId = request.authContext?.user.orgId;
    if (!orgId) return reply.status(400).send({ error: "User has no organization" });

    deleteScopedPolicy("org", orgId);
    return { ok: true };
  });

  /**
   * DELETE /api/policies/team/:teamId
   * Remove team-level policy override.
   */
  app.delete("/api/policies/team/:teamId", { preHandler: [requireAuth, requireCapability("policy:write")] }, async (request, reply) => {
    const { deleteScopedPolicy } = await import("../policy/policyChain");
    const { teamId } = request.params as { teamId: string };

    deleteScopedPolicy("team", Number(teamId));
    return { ok: true };
  });
}
