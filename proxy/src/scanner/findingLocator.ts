/**
 * Finding Locator
 *
 * Converts character offsets returned by scanners into 1-based line and
 * column numbers, and applies type-aware masking so raw secret values
 * never leave the proxy process.
 *
 * Single Responsibility: text-position → (line, column) and value masking.
 * No knowledge of the scanner pipeline or HTTP layer.
 */

/**
 * Pre-compute the starting character offset of every line in `content`.
 * One linear pass; subsequent lookups are O(log n) via binary search.
 *
 * Handles LF, CRLF, and CR line endings uniformly — for column purposes
 * we treat the offset of any newline as the end of its line.
 */
export function buildLineStarts(content: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i);
    if (ch === 0x0a /* \n */) {
      starts.push(i + 1);
    } else if (ch === 0x0d /* \r */) {
      // Skip the trailing \n of CRLF — the \n branch will handle it.
      if (i + 1 < content.length && content.charCodeAt(i + 1) === 0x0a) {
        continue;
      }
      starts.push(i + 1);
    }
  }
  return starts;
}

/**
 * Resolve a 0-based character offset to {line, column}, both 1-based.
 *
 * @param lineStarts pre-computed via buildLineStarts(content)
 * @param position   character offset in the same content
 */
export function locatePosition(
  lineStarts: number[],
  position: number,
): { line: number; column: number } {
  if (position <= 0) return { line: 1, column: 1 };

  // Binary search for the largest lineStart <= position.
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= position) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return {
    line: lo + 1,
    column: position - lineStarts[lo] + 1,
  };
}

const PII_LIKE_TYPES = new Set([
  "EMAIL",
  "PHONE",
  "SSN",
  "AADHAAR",
  "PAN",
  "CREDIT_CARD",
  "IP_ADDRESS",
]);

/**
 * Mask a sensitive value for display in scan reports. The proxy must
 * never return the raw value over the wire.
 *
 *  - Email:        local part masked, domain visible.
 *  - Phone/SSN/CC: last 4 visible.
 *  - Secrets:      first 4 + last 2 visible.
 *  - Short values: fully masked.
 */
export function maskValue(value: string, type: string): string {
  if (!value) return "";
  const upper = type.toUpperCase();

  if (upper === "EMAIL") {
    const at = value.indexOf("@");
    if (at <= 0) return mask(value);
    const local = value.slice(0, at);
    const domain = value.slice(at);
    const visible = local.length <= 2 ? (local[0] ?? "") : local.slice(0, 2);
    return `${visible}${"*".repeat(Math.max(2, local.length - visible.length))}${domain}`;
  }

  if (
    upper === "PHONE" ||
    upper === "SSN" ||
    upper === "CREDIT_CARD" ||
    upper === "AADHAAR" ||
    upper === "PAN"
  ) {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 4) return "*".repeat(digits.length);
    return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
  }

  if (PII_LIKE_TYPES.has(upper)) {
    return mask(value);
  }

  // Default: secret-style masking — first 4 + last 2 visible.
  if (value.length <= 6) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(value.length - 6)}${value.slice(-2)}`;
}

function mask(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  return `${value.slice(0, 1)}${"*".repeat(value.length - 2)}${value.slice(-1)}`;
}
