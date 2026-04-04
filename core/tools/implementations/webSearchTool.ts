/**
 * Web Search Tool — wraps searchWeb with domain allow/blocklist filtering.
 */

import { ToolImpl } from ".";
import { searchWebImpl } from "./searchWeb";

/**
 * Check whether a URL passes domain filtering.
 * If blocklist contains the domain, reject.
 * If allowlist is non-empty and domain is not in it, reject.
 */
export function filterDomains(
  url: string,
  allowlist: readonly string[],
  blocklist: readonly string[],
): boolean {
  try {
    const hostname = new URL(url).hostname;
    if (blocklist.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
      return false;
    }
    if (
      allowlist.length > 0 &&
      !allowlist.some((d) => hostname === d || hostname.endsWith(`.${d}`))
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export const webSearchToolImpl: ToolImpl = async (args, extras) => {
  const results = await searchWebImpl(args, extras);

  const allowlist: string[] = (args.allowlist as string[]) ?? [];
  const blocklist: string[] = (args.blocklist as string[]) ?? [];

  if (allowlist.length === 0 && blocklist.length === 0) {
    return results;
  }

  return results.filter((item) => {
    if (!item.description) return true; // keep non-URL items (e.g. warnings)
    return filterDomains(item.description, allowlist, blocklist);
  });
};
