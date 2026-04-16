import { URL } from "node:url";

import { getHeaders } from "../../../continueServer/stubs/headers";
import { PageData } from "./DocsCrawler";

// Phase H.H1c (SECURITY_HARDENING_PLAN.md) — replaced the hardcoded
// Continue.dev hosted crawl proxy with an env-driven URL. Self-host
// the equivalent /crawl endpoint and set this env var to re-enable
// docs crawling.
const CRAWL_PROXY_URL_ENV = "AI_FIREWALL_CRAWL_PROXY_URL";

function getCrawlProxyUrl(): string {
  const url = process.env[CRAWL_PROXY_URL_ENV];
  if (!url) {
    throw new Error(
      `Docs crawler not configured. Set ${CRAWL_PROXY_URL_ENV} to a self-hosted ` +
        `crawl proxy URL (the previous hardcoded Continue.dev endpoint was removed in ` +
        `SECURITY_HARDENING_PLAN.md Phase H.H1c).`,
    );
  }
  return url;
}

export class DefaultCrawler {
  constructor(
    private readonly startUrl: URL,
    private readonly maxRequestsPerCrawl: number,
    private readonly maxDepth: number,
  ) {}

  async crawl(): Promise<PageData[]> {
    const proxyUrl = getCrawlProxyUrl();
    const resp = await fetch(new URL("crawl", proxyUrl).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await getHeaders()),
      },
      body: JSON.stringify({
        startUrl: this.startUrl.toString(),
        maxDepth: this.maxDepth,
        limit: this.maxRequestsPerCrawl,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to crawl site (${resp.status}): ${text}`);
    }
    const json = (await resp.json()) as PageData[];
    return json;
  }
}
