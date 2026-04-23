import { BaseContextProvider } from "..";
import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
  FetchFunction,
} from "../..";
import { getHeaders } from "../../continueServer/stubs/headers";

// Web search now defaults to the AI Firewall proxy's /v1/web-search
// route (wraps Tavily / Brave / SerpAPI behind a single endpoint).
// Legacy deploys can still override with AI_FIREWALL_WEB_CONTEXT_PROXY_URL
// which expects the old `<base>/web` contract.
const LEGACY_WEB_PROXY_URL_ENV = "AI_FIREWALL_WEB_CONTEXT_PROXY_URL";
const DEFAULT_PROXY_BASE = "http://127.0.0.1:8080";

function getWebContextEndpoint(): { url: URL; legacy: boolean } {
  const legacy = process.env[LEGACY_WEB_PROXY_URL_ENV];
  if (legacy) {
    return { url: new URL("web", legacy), legacy: true };
  }
  const base = process.env.AI_FIREWALL_PROXY_URL ?? DEFAULT_PROXY_BASE;
  return { url: new URL("/v1/web-search", base), legacy: false };
}

export const fetchSearchResults = async (
  query: string,
  n: number,
  fetchFn: FetchFunction,
): Promise<ContextItem[]> => {
  const { url, legacy } = getWebContextEndpoint();
  const resp = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getHeaders()),
    },
    body: JSON.stringify({ query, n }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Failed to fetch web search from ${legacy ? "legacy endpoint" : "AI Firewall proxy"}: ${text}`,
    );
  }
  return await resp.json();
};

export default class WebContextProvider extends BaseContextProvider {
  private static DEFAULT_N = 6;

  static description: ContextProviderDescription = {
    title: "web",
    displayTitle: "Web",
    description: "Search the web",
    type: "normal",
    renderInlineAs: "",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    return await fetchSearchResults(
      extras.fullInput,
      this.options.n ?? WebContextProvider.DEFAULT_N,
      extras.fetch,
    );
  }
}
