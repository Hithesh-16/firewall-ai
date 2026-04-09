import cors from "@fastify/cors";
import Fastify from "fastify";
import { env } from "./config";
import path from "node:path";
import fs from "node:fs";
import fastifyStatic from "@fastify/static";
import { registerAiRoute } from "./routes/ai.route";
import { registerAuthRoutes } from "./routes/auth.route";
import { registerBrowserScanRoute } from "./routes/browserScan.route";
import { registerCreditRoutes } from "./routes/credit.route";
import { registerEstimateRoute } from "./routes/estimate.route";
import { registerExportRoutes } from "./routes/export.route";
import { registerHealthRoute } from "./routes/health.route";
import { registerPermissionRoute } from "./routes/permission.route";
import { registerVaultRoutes } from "./routes/vault.route";
import { registerLogsRoute } from "./routes/logs.route";
import { registerOrgRoutes } from "./routes/org.route";
import { registerPolicyRoutes } from "./routes/policy.route";
import { registerProviderRoutes } from "./routes/provider.route";
import { registerSimulatorRoute } from "./routes/simulator.route";
import { registerStatsRoute } from "./routes/stats.route";
import { registerUsageRoutes } from "./routes/usage.route";
import { registerAuditRoutes } from "./routes/audit.route";
import { registerPluginScanRoutes } from "./routes/pluginScan.route";
import { registerSSORoutes } from "./routes/sso.route";
import { registerAuthHandoffRoutes } from "./routes/authHandoff.route";
import { registerMeRoutes } from "./routes/me.route";
import { registerModelGrantRoutes } from "./routes/modelGrants.route";
import { registerOrgAssistantRoutes } from "./routes/orgAssistants.route";
import { registerWebLoginBridgeRoutes } from "./routes/webLoginBridge.route";
import { registerPublicConfigRoute } from "./routes/publicConfig.route";
import { registerWebhookRoutes } from "./routes/webhook.route";
import { registerFileScanRoutes } from "./routes/fileScan.route";
import { registerPreflightScanRoute } from "./routes/preflightScan.route";
import { registerMcpGatewayRoutes } from "./routes/mcpGateway.route";
import { registerApprovalRoutes } from "./routes/approval.route";
import { registerSessionRoutes } from "./routes/sessions.route";
import { registerNotificationRoutes } from "./routes/notification.route";
import { registerChannel } from "./notifications/notificationService";
import { webhookChannel } from "./notifications/channels/webhook";
import { slackChannel } from "./notifications/channels/slack";
import { emailChannel } from "./notifications/channels/email";
import { registerLicenseRoutes } from "./routes/license.route";
import { registerTeamRoutes } from "./routes/team.route";
import { registerScimRoutes } from "./routes/scim.route";
import { registerRbacRoutes } from "./routes/rbac.route";
import { registerReduceRoute } from "./routes/reduce.route";
import { registerTaskRoutes } from "./routes/task.route";
import { registerMemoryRoutes } from "./routes/memory.route";
import { registerAgentRoutes } from "./routes/agent.route";
import { registerCommandRoutes } from "./routes/command.route";
import { registerSkillRoutes } from "./routes/skill.route";
import { registerCronRoutes } from "./routes/cron.route";
import { registerPrivacyRoutes } from "./routes/privacy.route";
import { registerPluginRoutes } from "./routes/plugin.route";
import { registerSecurityAuditRoutes } from "./routes/securityAudit.route";
import { startWebhookPoller } from "./services/webhookQueue";
import { startScheduledReports } from "./export/scheduledReports";
import { logConfigSecurityWarnings } from "./middleware/configSecurityCheck";

async function bootstrap(): Promise<void> {
  const app = Fastify({
    // Fastify's default `maxParamLength` is 100, which truncates the
    // signed invite tokens (≈208 chars) and causes /api/auth/invites/:token
    // to 404. 1024 gives plenty of headroom for tokens, handoff nonces,
    // and future long path params.
    maxParamLength: 1024,
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      transport:
        process.env.NODE_ENV === "development"
          ? { target: "pino-pretty" }
          : undefined,
      // NEVER log request bodies — they contain the secrets we're scanning for
      serializers: {
        req: (req: { method: string; url: string }) => ({
          method: req.method,
          url: req.url,
        }),
      },
    },
  });

  // Lenient JSON body parser: treats an empty body as `{}` instead of
  // throwing FST_ERR_CTP_EMPTY_JSON_BODY. Matches the behaviour of
  // most REST frameworks and means no-body POSTs (like
  // `POST /api/users/me/onboarding/complete` or `POST /api/auth/logout`)
  // work regardless of whether the client sent `Content-Type: application/json`.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      const raw = typeof body === "string" ? body.trim() : "";
      if (raw.length === 0) {
        done(null, {});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        done(null, parsed);
      } catch (err) {
        // Tag the error so Fastify returns 400 instead of the default 500.
        const parseError = new Error(
          err instanceof Error ? err.message : "Invalid JSON",
        ) as Error & { statusCode?: number };
        parseError.statusCode = 400;
        done(parseError, undefined);
      }
    },
  );

  // SECURITY: Only allow known origins — never use { origin: true } in production
  const ALLOWED_ORIGINS = [
    "http://localhost:3000", // GUI dev server (legacy)
    "http://localhost:5173", // gui/ Vite dev server (IDE webview)
    "http://localhost:5174", // web/ Vite dev server (admin dashboard)
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    ...(env.CORS_ORIGINS
      ? env.CORS_ORIGINS.split(",").map((o: string) => o.trim())
      : []),
  ];

  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (same-origin, curl, server-to-server)
      if (!origin) return cb(null, true);
      // Allow VS Code webview origins (vscode-webview:// scheme)
      if (origin.startsWith("vscode-webview://")) return cb(null, true);
      // Allow configured origins
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error(`Origin ${origin} not allowed by CORS`), false);
    },
    credentials: true,
    // @fastify/cors's default allowed methods list is "GET, HEAD, POST",
    // which blocks every PUT / PATCH / DELETE from the browser with a
    // preflight failure. We use all five across the API — profile edits,
    // policy uploads, role deletion, token revocation — so enumerate them
    // explicitly here.
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // Reflect the headers the browser asks for during preflight.
    // `Authorization` + `Content-Type` cover every current route.
    allowedHeaders: ["Authorization", "Content-Type", "X-Requested-With"],
  });

  // Serve dashboard static files when available (air-gapped single-container mode)
  try {
    const dashboardDist = path.resolve(__dirname, "../../dashboard/dist");
    if (fs.existsSync(dashboardDist)) {
      await app.register(fastifyStatic, {
        root: dashboardDist,
        prefix: "/",
      });
      app.log.info(`Serving dashboard from ${dashboardDist}`);
    }
  } catch (e) {
    app.log.warn({ err: e }, "Dashboard static serve not available");
  }

  // Public routes
  await registerHealthRoute(app);

  // Auth routes (register/login are public, token mgmt is authenticated)
  await registerAuthRoutes(app);

  // Web-first auth bridge + local handoff (Phase 1 of unified auth refactor)
  await registerPublicConfigRoute(app);
  await registerWebLoginBridgeRoutes(app);
  await registerAuthHandoffRoutes(app);

  // Phase A/A.5/B/D — per-user bootstrap endpoints (policy,
  // assistant, models, personal providers).
  await registerMeRoutes(app);

  // Phase F (slice 1) — admin provisioning of org-level assistants.
  await registerOrgAssistantRoutes(app);

  // Phase F (slice 2) — admin CRUD for model access grants.
  await registerModelGrantRoutes(app);

  // Authenticated / role-gated routes
  await registerLogsRoute(app);
  await registerPolicyRoutes(app);
  await registerStatsRoute(app);
  await registerSimulatorRoute(app);
  await registerOrgRoutes(app);
  await registerTeamRoutes(app);
  await registerRbacRoutes(app);
  await registerScimRoutes(app);
  await registerExportRoutes(app);

  // Phase 4: Gateway routes
  await registerProviderRoutes(app);
  await registerCreditRoutes(app);
  await registerUsageRoutes(app);

  // Browser extension scan endpoint
  await registerBrowserScanRoute(app);

  // Pre-flight scan (called by core/llm/firewallScan.ts before every LLM request)
  await registerPreflightScanRoute(app);

  // File scanning (Phase 2)
  await registerFileScanRoutes(app);

  // MCP Security Gateway (Phase 3)
  await registerMcpGatewayRoutes(app);

  // Control Plane (Phase 4)
  await registerApprovalRoutes(app);
  await registerSessionRoutes(app);
  await registerNotificationRoutes(app);

  // Register notification channels (OCP: add new channels here)
  registerChannel(webhookChannel);
  registerChannel(slackChannel);
  registerChannel(emailChannel);

  // Task management (Phase 1: Agent Core)
  await registerTaskRoutes(app);

  // Persistent memory system (Phase 1: Agent Core)
  await registerMemoryRoutes(app);

  // Agent lifecycle management (Phase 1: Agent Core)
  await registerAgentRoutes(app);

  // Command system (Phase 2: Commands & Extensibility)
  await registerCommandRoutes(app);

  // Skills system (Phase 2: Commands & Extensibility)
  await registerSkillRoutes(app);

  // Scheduled triggers (Phase 3: Multi-Agent)
  await registerCronRoutes(app);

  // Context reduction (opt-in token optimization)
  await registerReduceRoute(app);

  // License management (Phase 5)
  await registerLicenseRoutes(app);

  // Permission prompt (interactive mode)
  await registerPermissionRoute(app);

  // Reversible token vault
  await registerVaultRoutes(app);

  // Pre-flight estimation
  await registerEstimateRoute(app);

  // Privacy settings
  await registerPrivacyRoutes(app);

  // Plugin management (list, enable/disable)
  await registerPluginRoutes(app);

  // Security audit (full-repo scan)
  await registerSecurityAuditRoutes(app);

  // Privacy audit (opt-in, Phase X)
  await registerAuditRoutes(app);
  registerPluginScanRoutes(app);

  // SSO authentication
  await registerSSORoutes(app);

  // Webhook notifications
  await registerWebhookRoutes(app);

  // Core proxy route (auth via API key header or .env)
  await registerAiRoute(app);

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`AI Firewall Gateway running on http://localhost:${env.PORT}`);

    // Check for plaintext API keys in config files (warn only, no modification)
    logConfigSecurityWarnings();

    // Start scheduled compliance reports
    startScheduledReports();

    // Start webhook delivery queue poller (Phase 5)
    startWebhookPoller();
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void bootstrap();
