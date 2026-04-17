import * as fs from "node:fs";
import { IdeSettings } from "..";
import {
  getLocalEnvironmentDotFilePath,
  getStagingEnvironmentDotFilePath,
} from "../util/paths";
import { AuthType, ControlPlaneEnv } from "./AuthTypes";
import { getLicenseKeyData } from "./mdm/mdm";

export const EXTENSION_NAME = "aiFirewall";

const WORKOS_CLIENT_ID_PRODUCTION = "client_01J0FW6XN8N2XJAECF7NE0Y65J";
const WORKOS_CLIENT_ID_STAGING = "client_01J0FW6XCPMJMQ3CG51RB4HBZQ";

const PRODUCTION_HUB_ENV: ControlPlaneEnv = {
  DEFAULT_CONTROL_PLANE_PROXY_URL: "http://localhost:8080/",
  CONTROL_PLANE_URL: "http://localhost:8080/",
  AUTH_TYPE: AuthType.WorkOsProd,
  WORKOS_CLIENT_ID: WORKOS_CLIENT_ID_PRODUCTION,
  APP_URL: "http://localhost:8080/",
};

const STAGING_ENV: ControlPlaneEnv = {
  DEFAULT_CONTROL_PLANE_PROXY_URL: "http://localhost:8080/",
  CONTROL_PLANE_URL: "http://localhost:8080/",
  AUTH_TYPE: AuthType.WorkOsStaging,
  WORKOS_CLIENT_ID: WORKOS_CLIENT_ID_STAGING,
  APP_URL: "http://localhost:8080/",
};

const TEST_ENV: ControlPlaneEnv = {
  DEFAULT_CONTROL_PLANE_PROXY_URL: "https://api-test.ai-firewall.dev/",
  CONTROL_PLANE_URL: "https://api-test.ai-firewall.dev/",
  AUTH_TYPE: AuthType.WorkOsStaging,
  WORKOS_CLIENT_ID: WORKOS_CLIENT_ID_STAGING,
  APP_URL: "https://app-test.ai-firewall.dev/",
};

const LOCAL_ENV: ControlPlaneEnv = {
  DEFAULT_CONTROL_PLANE_PROXY_URL: "http://localhost:3001/",
  CONTROL_PLANE_URL: "http://localhost:3001/",
  AUTH_TYPE: AuthType.WorkOsStaging,
  WORKOS_CLIENT_ID: WORKOS_CLIENT_ID_STAGING,
  APP_URL: "http://localhost:3000/",
};

// AI Firewall does not use Continue Hub / WorkOS auth — every install talks to
// the local proxy on :8080. Returning this when the caller passes "none" makes
// `isHubEnv()` return false, so `getControlPlaneSessionInfo()` reports
// AUTH_TYPE: "on-prem" and the WorkOsAuthProvider stops trying to refresh
// against /auth/refresh. Without this branch the function fell through to
// PRODUCTION_HUB_ENV and the stale WorkOS profile (userId/teamId/userName)
// from a prior Continue Hub login leaked into the chat panel.
const NONE_ENV: ControlPlaneEnv = {
  AUTH_TYPE: AuthType.OnPrem,
  DEFAULT_CONTROL_PLANE_PROXY_URL: "http://localhost:8080/",
  CONTROL_PLANE_URL: "http://localhost:8080/",
  APP_URL: "http://localhost:8080/",
};

// `enableHubContinueDev` removed 2026-04-17 (Phase H.H1b of
// SECURITY_HARDENING_PLAN.md). Was a hardcoded stub returning `true`
// with zero live callers — an artifact of the original Continue.dev
// hub feature gating.

export async function getControlPlaneEnv(
  ideSettingsPromise: Promise<IdeSettings>,
): Promise<ControlPlaneEnv> {
  const ideSettings = await ideSettingsPromise;
  return getControlPlaneEnvSync(ideSettings.continueTestEnvironment);
}

export function getControlPlaneEnvSync(
  ideTestEnvironment: IdeSettings["continueTestEnvironment"],
): ControlPlaneEnv {
  // Caller explicitly opted out of any Continue Hub / WorkOS flow.
  // Must be checked FIRST — before MDM/local/staging overrides — so the
  // WorkOsAuthProvider can reliably get a non-hub env regardless of which
  // dotfiles happen to be on disk.
  if (ideTestEnvironment === "none") {
    return NONE_ENV;
  }

  // MDM override
  const licenseKeyData = getLicenseKeyData();
  if (licenseKeyData?.unsignedData?.apiUrl) {
    const { apiUrl } = licenseKeyData.unsignedData;
    return {
      AUTH_TYPE: AuthType.OnPrem,
      DEFAULT_CONTROL_PLANE_PROXY_URL: apiUrl,
      CONTROL_PLANE_URL: apiUrl,
      APP_URL: "https://ai-firewall.dev/",
    };
  }

  // Note .local overrides .staging
  if (fs.existsSync(getLocalEnvironmentDotFilePath())) {
    return LOCAL_ENV;
  }

  if (fs.existsSync(getStagingEnvironmentDotFilePath())) {
    return STAGING_ENV;
  }

  const env =
    ideTestEnvironment === "production"
      ? "hub"
      : ideTestEnvironment === "staging"
        ? "staging"
        : ideTestEnvironment === "local"
          ? "local"
          : process.env.CONTROL_PLANE_ENV;

  return env === "local"
    ? LOCAL_ENV
    : env === "staging"
      ? STAGING_ENV
      : env === "test"
        ? TEST_ENV
        : PRODUCTION_HUB_ENV;
}

export async function useHub(
  ideSettingsPromise: Promise<IdeSettings>,
): Promise<boolean> {
  const ideSettings = await ideSettingsPromise;
  return ideSettings.continueTestEnvironment !== "none";
}
