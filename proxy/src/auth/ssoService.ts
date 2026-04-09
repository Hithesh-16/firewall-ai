import crypto from "node:crypto";
import { db } from "../db/index";
import { ssoSessions, users } from "../db/schema";
import { createUser, createApiToken } from "./authService";
import { assignOrgRole } from "./rbacService";
import { createOrg, assignUserToOrg } from "../org/orgService";
import { Role, User } from "../types";
import { eq } from "drizzle-orm";
import rawDb from "../db/database";

export type SSOProvider = "google" | "github" | "microsoft" | "oidc";

interface SSOConfig {
  provider: SSOProvider;
  clientId: string;
  clientSecret: string;
  issuerUrl?: string; // For generic OIDC
  redirectUri: string;
}

interface SSOUserProfile {
  externalId: string;
  email: string;
  name: string;
  provider: SSOProvider;
}

export function getSSOConfig(providerOverride?: string): SSOConfig | null {
  const provider = (providerOverride ||
    process.env.SSO_PROVIDER ||
    "") as SSOProvider;

  if (!provider) return null;

  const prefix = `SSO_${provider.toUpperCase()}_`;
  const clientId =
    process.env[`${prefix}CLIENT_ID`] || process.env.SSO_CLIENT_ID;
  const clientSecret =
    process.env[`${prefix}CLIENT_SECRET`] || process.env.SSO_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    provider,
    clientId,
    clientSecret,
    issuerUrl: process.env[`${prefix}ISSUER_URL`] || process.env.SSO_ISSUER_URL,
    redirectUri:
      process.env[`${prefix}REDIRECT_URI`] ||
      process.env.SSO_REDIRECT_URI ||
      "http://localhost:8080/api/auth/sso/callback",
  };
}

export function getAuthorizationUrl(config: SSOConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    state,
    scope: "openid email profile",
  });

  switch (config.provider) {
    case "google":
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    case "github":
      return `https://github.com/login/oauth/authorize?${params}`;
    case "microsoft":
      return `https://login.microsoftonline.com/common/oauth2/v2/authorize?${params}`;
    case "oidc":
      if (!config.issuerUrl) throw new Error("OIDC issuer URL required");
      return `${config.issuerUrl}/authorize?${params}`;
    default:
      throw new Error(`Unsupported SSO provider: ${config.provider}`);
  }
}

export async function exchangeCodeForProfile(
  config: SSOConfig,
  code: string,
): Promise<SSOUserProfile> {
  let tokenUrl: string;
  let userInfoUrl: string;

  switch (config.provider) {
    case "google":
      tokenUrl = "https://oauth2.googleapis.com/token";
      userInfoUrl = "https://www.googleapis.com/oauth2/v2/userinfo";
      break;
    case "github":
      tokenUrl = "https://github.com/login/oauth/access_token";
      userInfoUrl = "https://api.github.com/user";
      break;
    case "microsoft":
      tokenUrl = "https://login.microsoftonline.com/common/oauth2/v2/token";
      userInfoUrl = "https://graph.microsoft.com/v1.0/me";
      break;
    case "oidc":
      if (!config.issuerUrl) throw new Error("OIDC issuer URL required");
      tokenUrl = `${config.issuerUrl}/token`;
      userInfoUrl = `${config.issuerUrl}/userinfo`;
      break;
    default:
      throw new Error(`Unsupported SSO provider: ${config.provider}`);
  }

  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = (await tokenRes.json()) as Record<string, unknown>;
  const accessToken = tokenData.access_token as string;

  if (!accessToken) {
    throw new Error(`SSO token exchange failed: ${JSON.stringify(tokenData)}`);
  }

  const profileRes = await fetch(userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = (await profileRes.json()) as Record<string, unknown>;

  let email: string;
  let name: string;
  let externalId: string;

  if (config.provider === "github") {
    email = (profile.email as string) || `${profile.login}@github.com`;
    name = (profile.name as string) || (profile.login as string) || "User";
    externalId = String(profile.id);
  } else if (config.provider === "microsoft") {
    email =
      (profile.mail as string) || (profile.userPrincipalName as string) || "";
    name = (profile.displayName as string) || "User";
    externalId = profile.id as string;
  } else {
    email = (profile.email as string) || "";
    name = (profile.name as string) || "User";
    externalId = (profile.sub as string) || (profile.id as string) || "";
  }

  return { externalId, email, name, provider: config.provider };
}

export function findOrCreateSSOUser(profile: SSOUserProfile): {
  user: User;
  token: string;
} {
  const existing = db
    .select()
    .from(users)
    .where(eq(users.email, profile.email))
    .get();

  let user: User;

  if (existing) {
    user = {
      id: existing.id,
      email: existing.email,
      name: existing.name,
      role: existing.role as Role,
      orgId: existing.orgId,
      onboardingComplete:
        Number(
          (existing as { onboardingComplete?: number }).onboardingComplete ?? 0,
        ) === 1,
      timezone:
        (existing as { timezone?: string | null }).timezone ?? null,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    };
  } else {
    const randomPassword = crypto.randomBytes(32).toString("hex");
    user = createUser(
      profile.email,
      profile.name,
      randomPassword,
      "developer" as Role,
    );

    // Auto-create a personal org for SSO users
    const slug = profile.email
      .split("@")[0]
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-");
    const org = createOrg(
      `${profile.name}'s Organization`,
      `${slug}-${user.id}`,
    );
    assignUserToOrg(user.id, org.id);
    user.orgId = org.id;

    const systemRole = rawDb
      .prepare("SELECT id FROM roles WHERE name = ? AND is_system = 1")
      .get("developer") as { id: number } | undefined;
    if (systemRole) {
      assignOrgRole(user.id, org.id, systemRole.id);
    }
  }

  db.insert(ssoSessions)
    .values({
      userId: user.id,
      provider: profile.provider,
      externalId: profile.externalId,
      createdAt: Date.now(),
    })
    .run();

  const { token } = createApiToken(user.id, `sso-${profile.provider}`);

  return { user, token };
}
