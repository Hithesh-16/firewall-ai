import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole, requireCapability } from "../auth/authMiddleware";
import { loadPolicyConfig, savePolicyConfig } from "../config";
import type { PolicyConfig } from "../types";

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
   * Returns the fully resolved policy for the authenticated user
   * (global → org → role → team → project, strictest wins).
   */
  app.get("/api/policies/effective", { preHandler: requireAuth }, async (request, reply) => {
    const { resolveEffectivePolicy } = await import("../policy/policyChain");
    const user = request.authContext?.user;
    if (!user?.orgId) {
      return reply.status(400).send({ error: "User has no organization" });
    }
    const projectRoot = (request.query as Record<string, string>).projectRoot;
    return resolveEffectivePolicy(
      user.orgId,
      null,
      projectRoot,
      user.role as
        | "admin"
        | "security_lead"
        | "developer"
        | "auditor"
        | null
        | undefined,
    );
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

  // ── Role-scoped policies (Phase 4.5) ──────────────────────────────────
  //
  // Per-role policy overlays stored in the `role_policies` SQLite table
  // as JSON. Merged between the org-level and team-level steps of
  // `resolveEffectivePolicy`, strictest-wins, so role overrides can
  // only tighten the org baseline.
  //
  // All four routes require `policy:write` and verify the user is a
  // member of the org they're editing — an admin in org A cannot touch
  // role policies in org B.

  /**
   * GET /api/policies/role-template
   *
   * Returns the commented JSONC policy template the RBAC UI pre-fills
   * into the Policy tab when a user opens a custom role for the first
   * time. Every policy field is annotated with a // comment so the
   * user can learn the shape just by reading it.
   *
   * Also returns the field-by-field metadata the UI can render in a
   * side panel if desired.
   */
  app.get(
    "/api/policies/role-template",
    { preHandler: requireAuth },
    async () => {
      const { ROLE_POLICY_TEMPLATE_JSONC, ROLE_DEFAULT_POLICIES } =
        await import("../policy/roleDefaults");
      return {
        template: ROLE_POLICY_TEMPLATE_JSONC,
        defaults: ROLE_DEFAULT_POLICIES,
      };
    },
  );

  /**
   * Role name validator — accepts both the four system role names
   * and any custom role slug created via `POST /api/roles`. Custom
   * role names are slug-ified on create (lowercase alnum + dashes)
   * so we match that shape here.
   */
  const roleNameSchema = z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+$/i, "Role name must be a slug");

  // The partial policy shape accepted for role overrides. Intentionally
  // permissive — we only enforce JSON.stringify-ability and the well-known
  // top-level fields. Unknown fields are passed through so future
  // policy features don't require a route change.
  const rolePolicySchema = z
    .object({
      rules: z
        .object({
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
        })
        .optional(),
      severity_threshold: z.enum(["medium", "high", "critical"]).optional(),
      file_scope: z
        .object({
          blocklist: z.array(z.string()).optional(),
          allowlist: z.array(z.string()).optional(),
        })
        .optional(),
      blocked_paths: z.array(z.string()).optional(),
      prompt_injection: z
        .object({
          enabled: z.boolean().optional(),
          threshold: z.number().min(0).max(100).optional(),
        })
        .optional(),
      response_scanning: z
        .object({
          enabled: z.boolean().optional(),
        })
        .optional(),
    })
    .passthrough();

  /**
   * GET /api/policies/roles
   *
   * List every role override the current org has configured, plus a
   * row for every role WITHOUT an override so the UI can render all
   * 4 roles in one pass.
   */
  app.get(
    "/api/policies/roles",
    { preHandler: [requireAuth, requireCapability("policy:read")] },
    async (request, reply) => {
      const { listRolePolicies, SYSTEM_ROLES } = await import(
        "../policy/policyChain"
      );
      const orgId = request.authContext?.user.orgId;
      if (!orgId) {
        return reply.status(400).send({ error: "User has no organization" });
      }
      const stored = listRolePolicies(orgId);
      const byRole = new Map(stored.map((s) => [s.role, s]));
      return {
        roles: SYSTEM_ROLES.map((role) => {
          const s = byRole.get(role);
          return s
            ? {
                role,
                hasOverride: true,
                policy: s.policy,
                updatedAt: s.updatedAt,
              }
            : { role, hasOverride: false, policy: null, updatedAt: null };
        }),
      };
    },
  );

  /**
   * GET /api/policies/role/:roleName
   *
   * Fetch a single role's override (or `null` if none set).
   */
  app.get(
    "/api/policies/role/:roleName",
    { preHandler: [requireAuth, requireCapability("policy:read")] },
    async (request, reply) => {
      const { getRolePolicy } = await import("../policy/policyChain");
      const orgId = request.authContext?.user.orgId;
      if (!orgId) {
        return reply.status(400).send({ error: "User has no organization" });
      }
      const { roleName } = request.params as { roleName: string };
      const parsedRole = roleNameSchema.safeParse(roleName);
      if (!parsedRole.success) {
        return reply.status(400).send({ error: "Invalid role name" });
      }
      const found = getRolePolicy(orgId, parsedRole.data);
      if (!found) {
        return {
          role: parsedRole.data,
          hasOverride: false,
          policy: null,
          updatedAt: null,
        };
      }
      return {
        role: found.role,
        hasOverride: true,
        policy: found.policy,
        updatedAt: found.updatedAt,
      };
    },
  );

  /**
   * PUT /api/policies/role/:roleName
   *
   * Upsert a role override. Body is a PartialPolicy — fields omitted
   * fall through to the org default during resolution.
   */
  app.put(
    "/api/policies/role/:roleName",
    { preHandler: [requireAuth, requireCapability("policy:write")] },
    async (request, reply) => {
      const { saveRolePolicy } = await import("../policy/policyChain");
      const orgId = request.authContext?.user.orgId;
      if (!orgId) {
        return reply.status(400).send({ error: "User has no organization" });
      }
      const { roleName } = request.params as { roleName: string };
      const parsedRole = roleNameSchema.safeParse(roleName);
      if (!parsedRole.success) {
        return reply.status(400).send({ error: "Invalid role name" });
      }
      const parsedBody = rolePolicySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply
          .status(400)
          .send({
            error: "Invalid policy payload",
            details: parsedBody.error.flatten(),
          });
      }
      const stored = saveRolePolicy(
        orgId,
        parsedRole.data,
        parsedBody.data as Record<string, unknown>,
      );
      return {
        role: stored.role,
        hasOverride: true,
        policy: stored.policy,
        updatedAt: stored.updatedAt,
      };
    },
  );

  /**
   * DELETE /api/policies/role/:roleName
   *
   * Remove a role override. The role falls back to the org default
   * on the next request.
   */
  app.delete(
    "/api/policies/role/:roleName",
    { preHandler: [requireAuth, requireCapability("policy:write")] },
    async (request, reply) => {
      const { deleteRolePolicy } = await import("../policy/policyChain");
      const orgId = request.authContext?.user.orgId;
      if (!orgId) {
        return reply.status(400).send({ error: "User has no organization" });
      }
      const { roleName } = request.params as { roleName: string };
      const parsedRole = roleNameSchema.safeParse(roleName);
      if (!parsedRole.success) {
        return reply.status(400).send({ error: "Invalid role name" });
      }
      const deleted = deleteRolePolicy(orgId, parsedRole.data);
      return { ok: true, deleted };
    },
  );

  // ── Wizard-shaped policy endpoint ─────────────────────────────────────
  //
  // The web onboarding wizard collects policy choices at a higher level
  // than the raw policy.json fields (category toggles + thresholds
  // instead of per-rule booleans). This endpoint accepts that shape and
  // translates it into the canonical PolicyConfig, merged on top of the
  // existing file so unrelated sections (smart_routing rules, model
  // policies, etc.) are preserved.
  //
  // Using its own path + its own preHandler means the raw PUT /api/policy
  // endpoint above keeps working for admins editing the policy directly
  // (via the Policy Editor page), and a busy wizard can't clobber their
  // work.

  const wizardPolicySchema = z.object({
    scanners: z.object({
      secrets: z.object({
        enabled: z.boolean(),
        block: z.number().min(0).max(100),
        redact: z.number().min(0).max(100),
      }),
      pii: z.object({
        enabled: z.boolean(),
        block: z.number().min(0).max(100),
        redact: z.number().min(0).max(100),
      }),
      promptInjection: z.object({
        enabled: z.boolean(),
        block: z.number().min(0).max(100),
        redact: z.number().min(0).max(100),
      }),
      entropy: z.object({
        enabled: z.boolean(),
        block: z.number().min(0).max(100),
        redact: z.number().min(0).max(100),
      }),
      unicode: z.object({
        enabled: z.boolean(),
        block: z.number().min(0).max(100),
        redact: z.number().min(0).max(100),
      }),
    }),
    responseScanning: z.boolean(),
    mcpGateway: z.boolean(),
    mcpAudit: z.boolean(),
    costRouting: z.object({
      enabled: z.boolean(),
      perRequestUsdCap: z.number().min(0).optional(),
    }),
  });

  /**
   * GET /api/policy/wizard
   *
   * Returns the wizard's view of the current policy so the onboarding
   * page can pre-fill the sliders / toggles on a hard refresh instead
   * of always showing defaults.
   */
  app.get(
    "/api/policy/wizard",
    { preHandler: requireAuth },
    async () => {
      const current = loadPolicyConfig() as unknown as Record<string, any>;
      const r = (current.rules || {}) as Record<string, boolean>;
      // Secrets "enabled" = any of the secret-flavored rules is on.
      const secretsEnabled =
        !!r.block_private_keys ||
        !!r.block_aws_keys ||
        !!r.block_db_urls ||
        !!r.block_github_tokens ||
        !!r.redact_jwt ||
        !!r.redact_generic_api_keys;
      const piiEnabled = !!r.redact_emails || !!r.redact_phone;
      const injThreshold = current.prompt_injection?.threshold ?? 60;

      return {
        scanners: {
          secrets: { enabled: secretsEnabled, block: 70, redact: 40 },
          pii: { enabled: piiEnabled, block: 60, redact: 30 },
          promptInjection: {
            enabled: current.prompt_injection?.enabled ?? true,
            block: 100 - injThreshold,
            redact: Math.max(0, 80 - injThreshold),
          },
          entropy: { enabled: true, block: 75, redact: 45 },
          unicode: {
            enabled: current.unicode_normalization?.enabled ?? true,
            block: current.unicode_normalization?.block_on_anomaly ? 90 : 70,
            redact: 40,
          },
        },
        responseScanning: !!current.response_scanning?.enabled,
        mcpGateway: true,
        mcpAudit: true,
        costRouting: {
          enabled: !!current.smart_routing?.cost_routing?.enabled,
          perRequestUsdCap:
            current.smart_routing?.cost_routing?.maxCostPerRequest ?? undefined,
        },
      };
    },
  );

  /**
   * POST /api/policy/wizard
   *
   * Accepts the wizard's payload and translates it into the real
   * PolicyConfig shape, merging on top of the current file so unrelated
   * sections survive.
   *
   * Role check: admin OR security_lead (same as PUT /api/policy), so
   * an invited developer can't rewrite the policy through the wizard.
   */
  app.post(
    "/api/policy/wizard",
    { preHandler: requireRole("admin", "security_lead") },
    async (request, reply) => {
      const parsed = wizardPolicySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid wizard payload", details: parsed.error.flatten() });
      }
      const w = parsed.data;
      // Cast to a broader shape so we can read optional top-level
      // sections that aren't in the strict PolicyConfig type.
      const current = loadPolicyConfig() as unknown as Record<string, any>;

      // Merge: keep existing fields, then overlay the wizard choices.
      const next: Record<string, any> = {
        ...current,
        rules: {
          ...current.rules,
          block_private_keys: w.scanners.secrets.enabled,
          block_aws_keys: w.scanners.secrets.enabled,
          block_db_urls: w.scanners.secrets.enabled,
          block_github_tokens: w.scanners.secrets.enabled,
          redact_emails: w.scanners.pii.enabled,
          redact_phone: w.scanners.pii.enabled,
          redact_jwt: w.scanners.secrets.enabled,
          redact_generic_api_keys: w.scanners.secrets.enabled,
          allow_source_code: current.rules?.allow_source_code ?? true,
          log_all_requests: current.rules?.log_all_requests ?? true,
        },
        unicode_normalization: {
          enabled: w.scanners.unicode.enabled,
          block_on_anomaly: w.scanners.unicode.block >= 85,
        },
        prompt_injection: {
          enabled: w.scanners.promptInjection.enabled,
          // Slider is "block at or above this score" so threshold = 100 - block.
          threshold: Math.max(0, Math.min(100, 100 - w.scanners.promptInjection.block)),
        },
        response_scanning: {
          ...(current.response_scanning || {}),
          enabled: w.responseScanning,
          scan_secrets: current.response_scanning?.scan_secrets ?? true,
          scan_pii: current.response_scanning?.scan_pii ?? true,
          redact_on_detection:
            current.response_scanning?.redact_on_detection ?? false,
          stream_buffer_size:
            current.response_scanning?.stream_buffer_size ?? 500,
        },
        smart_routing: {
          ...(current.smart_routing || {}),
          enabled: current.smart_routing?.enabled ?? false,
          routes: current.smart_routing?.routes ?? [],
          local_llm: current.smart_routing?.local_llm ?? {
            provider: "ollama",
            model: "llama3",
            endpoint: "http://localhost:11434",
          },
          cost_routing: {
            enabled: w.costRouting.enabled,
            maxCostPerRequest: w.costRouting.perRequestUsdCap ?? null,
            preferCheaper:
              current.smart_routing?.cost_routing?.preferCheaper ?? false,
            rules: current.smart_routing?.cost_routing?.rules ?? [],
          },
        },
      };

      savePolicyConfig(next as PolicyConfig);
      return { ok: true };
    },
  );
}
