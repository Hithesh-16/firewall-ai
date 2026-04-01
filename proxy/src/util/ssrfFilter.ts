/**
 * SSRF Filter
 *
 * Pure utility for detecting private/internal IP addresses and hostnames.
 * Prevents Server-Side Request Forgery by blocking requests to:
 * - Loopback (127.0.0.0/8, ::1)
 * - RFC 1918 private ranges (10.x, 172.16-31.x, 192.168.x)
 * - Link-local (169.254.x — AWS metadata endpoint)
 * - localhost hostname
 *
 * Reused by:
 * - Phase 3: hookSchemas.ts (webhook URL validation)
 * - Phase 4: browserPool.ts (navigation SSRF guard)
 */

const PRIVATE_RANGES = [
  // Loopback
  /^127\./,
  /^::1$/,
  /^0\.0\.0\.0$/,
  // RFC 1918
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  // Link-local (AWS metadata, Azure IMDS)
  /^169\.254\./,
  // IPv6 private
  /^f[cd]/i,
  /^fe80:/i,
];

const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
]);

/**
 * Check if a hostname or IP address is private/internal.
 *
 * @param hostname - Hostname or IP to check (e.g., "127.0.0.1", "localhost", "10.0.1.5")
 * @returns true if the address is private/internal
 */
export function isPrivateIp(hostname: string): boolean {
  const lower = hostname.toLowerCase().trim();

  if (PRIVATE_HOSTNAMES.has(lower)) {
    return true;
  }

  return PRIVATE_RANGES.some((pattern) => pattern.test(lower));
}

/**
 * Validate a URL for SSRF safety.
 *
 * @param url - URL string to validate
 * @returns { safe: true } or { safe: false, reason: string }
 */
export function validateUrlForSSRF(url: string): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(url);

    if (isPrivateIp(parsed.hostname)) {
      return {
        safe: false,
        reason: `Hostname ${parsed.hostname} resolves to a private/internal address`,
      };
    }

    return { safe: true };
  } catch {
    return { safe: false, reason: "Invalid URL" };
  }
}
