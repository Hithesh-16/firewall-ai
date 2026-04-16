import { useEffect } from "react";

interface DocumentHead {
  title?: string;
  description?: string;
  keywords?: string;
  canonical?: string;
  /** Open Graph image URL for social previews. */
  ogImage?: string;
  /**
   * Whether crawlers should index this page. Defaults to true.
   * Pass `false` for auth-protected or private surfaces.
   */
  index?: boolean;
}

const DEFAULT_TITLE = "AI Firewall";

const upsertMeta = (attr: "name" | "property", key: string, value: string | undefined) => {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!value) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", value);
};

const upsertLink = (rel: string, href: string | undefined) => {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!href) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
};

/**
 * Manages `<head>` meta tags for SEO on a per-page basis.
 *
 * NOTE on rendering: this runs client-side. Crawlers that execute JS
 * (Googlebot) will see the updated tags; crawlers that don't (most
 * others, including link-preview fetchers for Slack/Twitter/LinkedIn)
 * will only see whatever is in `index.html`.
 *
 * For full SEO coverage on the public pages we should either (a)
 * prerender `/` and `/login` at build time, or (b) adopt a proper SSR
 * framework. This hook is the call-site API that both approaches
 * feed into.
 */
export function useDocumentHead({
  title,
  description,
  keywords,
  canonical,
  ogImage,
  index = true,
}: DocumentHead): void {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = title ? `${title} · ${DEFAULT_TITLE}` : DEFAULT_TITLE;

    upsertMeta("name", "description", description);
    upsertMeta("name", "keywords", keywords);
    upsertMeta("name", "robots", index ? "index,follow" : "noindex,nofollow");

    upsertMeta("property", "og:title", title ?? DEFAULT_TITLE);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:type", "website");
    upsertMeta("property", "og:image", ogImage);

    upsertMeta("name", "twitter:card", ogImage ? "summary_large_image" : "summary");
    upsertMeta("name", "twitter:title", title ?? DEFAULT_TITLE);
    upsertMeta("name", "twitter:description", description);
    upsertMeta("name", "twitter:image", ogImage);

    upsertLink("canonical", canonical);

    return () => {
      document.title = prevTitle;
    };
  }, [title, description, keywords, canonical, ogImage, index]);
}
