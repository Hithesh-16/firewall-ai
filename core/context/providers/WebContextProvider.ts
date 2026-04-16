import { BaseContextProvider } from "..";
import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
  FetchFunction,
} from "../..";
import { getHeaders } from "../../continueServer/stubs/headers";

// Phase H.H1c (SECURITY_HARDENING_PLAN.md) — replaced the hardcoded
// Continue.dev hosted web-search proxy with an env-driven URL.
// Self-host the equivalent /web endpoint and set this env var to
// re-enable the @web context provider.
const WEB_PROXY_URL_ENV = "AI_FIREWALL_WEB_CONTEXT_PROXY_URL";

function getWebContextEndpoint(): URL {
  const url = process.env[WEB_PROXY_URL_ENV];
  if (!url) {
    throw new Error(
      `@web context provider not configured. Set ${WEB_PROXY_URL_ENV} to a ` +
        `self-hosted web-search proxy URL (the previous hardcoded Continue.dev ` +
        `endpoint was removed in SECURITY_HARDENING_PLAN.md Phase H.H1c).`,
    );
  }
  return new URL("web", url);
}

export const fetchSearchResults = async (
  query: string,
  n: number,
  fetchFn: FetchFunction,
): Promise<ContextItem[]> => {
  const resp = await fetchFn(getWebContextEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getHeaders()),
    },
    body: JSON.stringify({
      query,
      n,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to fetch web context: ${text}`);
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
