import { FastifyInstance } from "fastify";
import { z } from "zod";
import { optionalAuth } from "../auth/authMiddleware";

const MAX_EXTRACT_URLS = 10;

/**
 * /v1/web-search — agent-facing web search endpoint.
 *
 * The core `search_web` tool posts {query, n} here and expects an
 * array of context-item-shaped results ({name, description, content}).
 *
 * Provider is selected by env var in this order:
 *   TAVILY_API_KEY       → Tavily Search API (default)
 *   BRAVE_SEARCH_API_KEY → Brave Search
 *   SERPAPI_API_KEY      → SerpAPI
 *
 * If none is set the route returns a single result item instructing
 * the user how to configure one. We deliberately return a 200 with a
 * helpful payload instead of a 5xx so the agent can relay the message
 * to the user instead of crashing the stream.
 */

const requestSchema = z.object({
  query: z.string().min(1).max(2000),
  n: z.number().int().min(1).max(20).optional(),
});

type Provider = "tavily" | "brave" | "serpapi" | "none";

function pickProvider(): Provider {
  if (process.env.TAVILY_API_KEY) return "tavily";
  if (process.env.BRAVE_SEARCH_API_KEY) return "brave";
  if (process.env.SERPAPI_API_KEY) return "serpapi";
  return "none";
}

interface SearchItem {
  name: string;
  description: string;
  content: string;
}

async function searchTavily(query: string, n: number): Promise<SearchItem[]> {
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      max_results: n,
      include_answer: true,
      search_depth: "basic",
    }),
  });
  if (!resp.ok) {
    throw new Error(`Tavily ${resp.status}: ${await resp.text()}`);
  }
  const data = (await resp.json()) as {
    answer?: string;
    results?: Array<{ title: string; url: string; content: string }>;
  };
  const items: SearchItem[] = [];
  if (data.answer) {
    items.push({
      name: "Tavily summary",
      description: query,
      content: data.answer,
    });
  }
  for (const r of data.results ?? []) {
    items.push({
      name: r.title,
      description: r.url,
      content: r.content,
    });
  }
  return items;
}

async function searchBrave(query: string, n: number): Promise<SearchItem[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(n, 20)));
  const resp = await fetch(url, {
    headers: {
      "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY!,
      Accept: "application/json",
    },
  });
  if (!resp.ok) {
    throw new Error(`Brave ${resp.status}: ${await resp.text()}`);
  }
  const data = (await resp.json()) as {
    web?: {
      results?: Array<{ title: string; url: string; description?: string }>;
    };
  };
  return (data.web?.results ?? []).map((r) => ({
    name: r.title,
    description: r.url,
    content: r.description ?? "",
  }));
}

async function searchSerpApi(query: string, n: number): Promise<SearchItem[]> {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(n, 20)));
  url.searchParams.set("api_key", process.env.SERPAPI_API_KEY!);
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`SerpAPI ${resp.status}: ${await resp.text()}`);
  }
  const data = (await resp.json()) as {
    organic_results?: Array<{
      title: string;
      link: string;
      snippet?: string;
    }>;
  };
  return (data.organic_results ?? []).map((r) => ({
    name: r.title,
    description: r.link,
    content: r.snippet ?? "",
  }));
}

const extractRequestSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(MAX_EXTRACT_URLS),
});

interface ExtractItem {
  url: string;
  title?: string;
  content: string;
  status: "ok" | "failed";
  error?: string;
}

/**
 * Batch URL extraction. Prefers Tavily's /extract endpoint (fast,
 * returns clean markdown, no scraping permission issues); falls back
 * to parallel direct fetch with raw HTML pass-through so the caller
 * can run their own Readability pipeline when needed.
 *
 * Keeping this behind the firewall means every extracted page flows
 * through the same proxy that scans LLM requests — future work can
 * plug scanner hooks in here to redact secrets that surface in
 * third-party web content.
 */
async function extractWithTavily(urls: string[]): Promise<ExtractItem[]> {
  const resp = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({ urls, extract_depth: "basic" }),
  });
  if (!resp.ok) {
    throw new Error(`Tavily extract ${resp.status}: ${await resp.text()}`);
  }
  const data = (await resp.json()) as {
    results?: Array<{ url: string; raw_content?: string; title?: string }>;
    failed_results?: Array<{ url: string; error: string }>;
  };
  const out: ExtractItem[] = [];
  for (const r of data.results ?? []) {
    out.push({
      url: r.url,
      title: r.title,
      content: r.raw_content ?? "",
      status: "ok",
    });
  }
  for (const f of data.failed_results ?? []) {
    out.push({
      url: f.url,
      content: "",
      status: "failed",
      error: f.error,
    });
  }
  return out;
}

async function extractWithDirectFetch(urls: string[]): Promise<ExtractItem[]> {
  const fetches = urls.map(async (url): Promise<ExtractItem> => {
    try {
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; AI-Firewall/1.0; +https://ai-firewall.dev/bot)",
        },
      });
      if (!resp.ok) {
        return {
          url,
          content: "",
          status: "failed",
          error: `HTTP ${resp.status}`,
        };
      }
      const text = await resp.text();
      // Raw HTML — the core tool runs it through Readability / JSDOM
      // before handing to the LLM.
      return { url, content: text, status: "ok" };
    } catch (err) {
      return {
        url,
        content: "",
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
  return Promise.all(fetches);
}

export async function registerWebSearchRoute(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/v1/web-search",
    { preHandler: optionalAuth },
    async (request, reply) => {
      const parsed = requestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }
      const { query, n = 5 } = parsed.data;
      const provider = pickProvider();

      if (provider === "none") {
        return reply.send([
          {
            name: "Web search is not configured",
            description: "configure a provider",
            content:
              "No web-search provider is configured on the AI Firewall proxy. " +
              "Set one of TAVILY_API_KEY, BRAVE_SEARCH_API_KEY, or SERPAPI_API_KEY " +
              "in the proxy environment and restart the proxy. Do not retry search_web until configured.",
          },
        ]);
      }

      try {
        const items =
          provider === "tavily"
            ? await searchTavily(query, n)
            : provider === "brave"
              ? await searchBrave(query, n)
              : await searchSerpApi(query, n);
        if (items.length === 0) {
          return reply.send([
            {
              name: "No results",
              description: query,
              content: `The ${provider} search returned no results for "${query}". Rephrase or narrow the query.`,
            },
          ]);
        }
        return reply.send(items);
      } catch (err) {
        request.log.warn({ err, provider }, "web-search upstream failed");
        return reply.status(502).send({
          error: "web_search_upstream_failed",
          provider,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  /**
   * POST /v1/web-extract — batch-extract article content from a list
   * of URLs. Uses Tavily /extract when configured (returns clean
   * content), otherwise falls back to direct HTTP fetch with raw HTML
   * returned so the caller's Readability pipeline can extract.
   */
  app.post(
    "/v1/web-extract",
    { preHandler: optionalAuth },
    async (request, reply) => {
      const parsed = extractRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }
      const { urls } = parsed.data;
      const hasTavily = !!process.env.TAVILY_API_KEY;
      try {
        const items = hasTavily
          ? await extractWithTavily(urls)
          : await extractWithDirectFetch(urls);
        return reply.send({
          provider: hasTavily ? "tavily" : "direct",
          items,
        });
      } catch (err) {
        request.log.warn({ err, hasTavily }, "web-extract upstream failed");
        // Fall back to direct fetch if tavily errored so the caller
        // still gets something usable.
        if (hasTavily) {
          try {
            const items = await extractWithDirectFetch(urls);
            return reply.send({ provider: "direct-fallback", items });
          } catch (fallbackErr) {
            return reply.status(502).send({
              error: "web_extract_upstream_failed",
              message:
                fallbackErr instanceof Error
                  ? fallbackErr.message
                  : String(fallbackErr),
            });
          }
        }
        return reply.status(502).send({
          error: "web_extract_upstream_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}
