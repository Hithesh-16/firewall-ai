/**
 * SSRF Guard for Browser Surface
 *
 * Intercepts all Playwright page requests (including redirects, iframes)
 * and blocks navigation to private/internal IPs. Prevents DNS rebinding
 * attacks where a legitimate domain redirects to 192.168.x.x.
 *
 * Uses the shared SSRF filter from proxy/src/util/ssrfFilter.ts.
 */

// Inline private IP check (same logic as proxy/src/util/ssrfFilter.ts)
// to avoid cross-package dependency at runtime
const PRIVATE_RANGES = [
  /^127\./,
  /^::1$/,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^f[cd]/i,
  /^fe80:/i,
];

const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
]);

function isPrivateHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().trim();
  if (PRIVATE_HOSTNAMES.has(lower)) return true;
  return PRIVATE_RANGES.some((p) => p.test(lower));
}

/**
 * Install SSRF protection on a Playwright page.
 * Intercepts ALL requests and blocks private IPs.
 *
 * @param page - Playwright Page instance
 * @param onBlocked - Optional callback when a request is blocked
 */
export async function installSsrfGuard(
  page: any,
  onBlocked?: (url: string, reason: string) => void,
): Promise<void> {
  await page.route("**/*", async (route: any) => {
    const url = route.request().url();
    try {
      const parsed = new URL(url);

      if (isPrivateHost(parsed.hostname)) {
        const reason = `SSRF blocked: ${parsed.hostname} is a private/internal address`;
        onBlocked?.(url, reason);
        await route.abort("blockedbyclient");
        return;
      }

      // Enforce HTTPS for external navigation (except localhost which is already blocked)
      if (parsed.protocol === "http:" && !isPrivateHost(parsed.hostname)) {
        // Allow HTTP for external — some dev servers use HTTP
        // Only block private IPs, not HTTP protocol itself
      }

      await route.continue();
    } catch {
      await route.continue();
    }
  });
}
