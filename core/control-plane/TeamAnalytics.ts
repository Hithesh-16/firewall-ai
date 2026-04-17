import os from "node:os";

import {
  ControlPlaneProxyInfo,
  IAnalyticsProvider,
} from "./analytics/IAnalyticsProvider.js";
import LogStashAnalyticsProvider from "./analytics/LogStashAnalyticsProvider.js";
import PostHogAnalyticsProvider from "./analytics/PostHogAnalyticsProvider.js";
import { ControlPlaneClient } from "./client.js";
import { AnalyticsConfig } from "../index.js";

// Phase H.H1d (SECURITY_HARDENING_PLAN.md, 2026-04-17):
// `ContinueProxyAnalyticsProvider` was registered for
// `config.provider === "continue-proxy"` and posted analytics events
// to Continue.dev's hosted endpoint. The class was never instantiated
// at runtime — `TeamAnalytics.setup()` is commented out (FIXME for
// workspaceId in doLoadConfig.ts) — so removing it leaves the live
// PostHog path untouched. Self-hosted analytics can be re-added as a
// new provider when needed; we don't need a Continue-branded one.
function createAnalyticsProvider(
  config: AnalyticsConfig,
): IAnalyticsProvider | undefined {
  // @ts-ignore
  switch (config.provider) {
    case "posthog":
      return new PostHogAnalyticsProvider();
    case "logstash":
      return new LogStashAnalyticsProvider();
    default:
      return undefined;
  }
}

export class TeamAnalytics {
  static provider: IAnalyticsProvider | undefined = undefined;
  static uniqueId = "NOT_UNIQUE";
  static os: string | undefined = undefined;
  static extensionVersion: string | undefined = undefined;

  static async capture(event: string, properties: { [key: string]: any }) {
    void TeamAnalytics.provider?.capture(event, {
      ...properties,
      os: TeamAnalytics.os,
      extensionVersion: TeamAnalytics.extensionVersion,
    });
  }

  static async setup(
    config: AnalyticsConfig,
    uniqueId: string,
    extensionVersion: string,
    controlPlaneClient: ControlPlaneClient,
    controlPlaneProxyInfo: ControlPlaneProxyInfo,
  ) {
    TeamAnalytics.uniqueId = uniqueId;
    TeamAnalytics.os = os.platform();
    TeamAnalytics.extensionVersion = extensionVersion;

    TeamAnalytics.provider = createAnalyticsProvider(config);
    await TeamAnalytics.provider?.setup(
      config,
      uniqueId,
      controlPlaneProxyInfo,
    );

    // Phase H.H1d — `continue-proxy` analytics provider was deleted
    // along with its post-setup `controlPlaneClient` injection. The
    // surviving providers (PostHog, LogStash) don't need it.
  }

  static async shutdown() {
    if (TeamAnalytics.provider) {
      await TeamAnalytics.provider.shutdown();
      TeamAnalytics.provider = undefined;
      TeamAnalytics.os = undefined;
      TeamAnalytics.extensionVersion = undefined;
      TeamAnalytics.uniqueId = "NOT_UNIQUE";
    }
  }
}
