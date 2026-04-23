import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { NodeHtmlMarkdown } from "node-html-markdown";

import { fetchSearchResults } from "../../context/providers/WebContextProvider";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { getHeaders } from "../../continueServer/stubs/headers";
import { getStringArg } from "../parseArgs";

import { ToolImpl } from ".";

/**
 * research_web — end-to-end web research: search + extract + return.
 *
 * Pipeline:
 *   1. Hit `/v1/web-search` for top-N candidate URLs (Tavily / Brave / SerpAPI).
 *   2. Hit `/v1/web-extract` to pull full content for every URL in parallel.
 *      Tavily's /extract returns clean markdown; direct-fetch fallback
 *      returns raw HTML that we run through Readability + JSDOM client-side.
 *   3. Emit one ContextItem per source plus a top-level summary item so
 *      the LLM has both the synthesis material and the citations.
 *
 * This is the tool the agent should reach for whenever the user says
 * "analyse this on the web" — it mirrors what Anthropic's built-in
 * web_research and Tavily's research API do, except all traffic flows
 * through the AI Firewall proxy so scanner hooks can scrub returned
 * content before it reaches the LLM.
 */

const DEFAULT_MAX_SOURCES = 5;
const ABSOLUTE_MAX_SOURCES = 10;
const PER_SOURCE_CHAR_LIMIT = 8000;

const DEFAULT_PROXY_BASE = "http://127.0.0.1:8080";

interface ExtractResponse {
  provider: string;
  items: Array<{
    url: string;
    title?: string;
    content: string;
    status: "ok" | "failed";
    error?: string;
  }>;
}

function getProxyBase(): string {
  return process.env.AI_FIREWALL_PROXY_URL ?? DEFAULT_PROXY_BASE;
}

function extractUrlFromResult(item: {
  description?: string;
  content?: string;
}): string | null {
  // The /v1/web-search contract puts URLs in `description` for
  // Tavily/Brave/SerpAPI rows. Tavily's summary item doesn't have a
  // URL — skip those.
  if (!item.description) return null;
  try {
    const url = new URL(item.description);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function extractUrls(
  urls: string[],
  fetchFn: typeof fetch,
): Promise<ExtractResponse | null> {
  if (urls.length === 0) return null;
  try {
    const resp = await fetchFn(new URL("/v1/web-extract", getProxyBase()), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await getHeaders()),
      },
      body: JSON.stringify({ urls }),
    });
    if (!resp.ok) {
      return null;
    }
    return (await resp.json()) as ExtractResponse;
  } catch {
    return null;
  }
}

function htmlToMarkdown(html: string): string {
  try {
    const dom = new JSDOM(html);
    const article = new Readability(dom.window.document).parse();
    const body = article?.content ?? "";
    if (!body) return "";
    return NodeHtmlMarkdown.translate(body, {}, undefined, undefined);
  } catch {
    return "";
  }
}

function truncate(content: string, limit = PER_SOURCE_CHAR_LIMIT): string {
  if (content.length <= limit) return content;
  return `${content.slice(0, limit)}\n\n[... truncated, ${content.length - limit} more chars]`;
}

export const researchWebImpl: ToolImpl = async (args, extras) => {
  const query = getStringArg(args, "query").trim();
  if (query.length === 0) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      "research_web: `query` must be a non-empty string.",
    );
  }

  const rawMax = (args.max_sources as string | number | undefined)?.toString();
  const parsedMax = rawMax ? Number.parseInt(rawMax, 10) : DEFAULT_MAX_SOURCES;
  const maxSources = Number.isFinite(parsedMax)
    ? Math.min(ABSOLUTE_MAX_SOURCES, Math.max(1, parsedMax))
    : DEFAULT_MAX_SOURCES;

  // Step 1: search.
  let searchItems: Array<{
    name: string;
    description: string;
    content: string;
  }> = [];
  try {
    const results = await fetchSearchResults(query, maxSources, extras.fetch);
    searchItems = results.map((r) => ({
      name: r.name,
      description: r.description,
      content: r.content,
    }));
  } catch (err) {
    return [
      {
        name: "Web research failed",
        description: query,
        content: `Failed to reach the web search endpoint: ${err instanceof Error ? err.message : String(err)}. If web search isn't configured, set TAVILY_API_KEY on the proxy.`,
      },
    ];
  }

  if (searchItems.length === 0) {
    return [
      {
        name: "No results",
        description: query,
        content: `Search returned nothing for "${query}". Rephrase the query or broaden the keywords.`,
      },
    ];
  }

  // Step 2: extract full content for each URL.
  const urls = searchItems
    .map(extractUrlFromResult)
    .filter((u): u is string => u !== null);
  const extracted = await extractUrls(urls, extras.fetch as typeof fetch);

  const contentByUrl = new Map<string, { title?: string; content: string }>();
  if (extracted?.items) {
    for (const item of extracted.items) {
      if (item.status !== "ok" || !item.content) continue;
      const content =
        extracted.provider === "tavily"
          ? item.content
          : htmlToMarkdown(item.content);
      if (!content.trim()) continue;
      contentByUrl.set(item.url, { title: item.title, content });
    }
  }

  // Step 3: build ContextItems — one summary header, then one per
  // source. The header gives the LLM a quick snapshot so it can decide
  // whether to dig further. Per-source items carry the substantive
  // content it will synthesise from.
  const sourcesRendered = searchItems
    .map((item, idx) => {
      const url = extractUrlFromResult(item);
      const badge = url && contentByUrl.has(url) ? "✓ extracted" : "↗ snippet";
      return `${idx + 1}. **${item.name}** — ${badge}\n   ${item.description || "(no URL)"}`;
    })
    .join("\n\n");

  const headline = {
    name: `Web research: ${query}`,
    description: `${contentByUrl.size}/${urls.length} full extractions · ${searchItems.length} results`,
    content: [
      `Query: ${query}`,
      ``,
      `Sources:`,
      sourcesRendered,
      ``,
      `Use the per-source context items below to cite specific claims. Prefer extracted content over snippet-only summaries.`,
    ].join("\n"),
  };

  const sourceItems = searchItems.map((item, idx) => {
    const url = extractUrlFromResult(item);
    const full = url ? contentByUrl.get(url) : undefined;
    const body = full?.content
      ? truncate(full.content)
      : item.content || "(no content)";
    return {
      name: full?.title ?? item.name,
      description: item.description,
      content: [
        `Source ${idx + 1}: ${full?.title ?? item.name}`,
        url ? `URL: ${url}` : null,
        ``,
        body,
      ]
        .filter(Boolean)
        .join("\n"),
      uri: url ? { type: "url" as const, value: url } : undefined,
    };
  });

  return [headline, ...sourceItems];
};
