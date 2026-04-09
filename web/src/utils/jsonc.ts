/**
 * Strip "//" line comments from a JSONC string, leaving a valid JSON
 * string that `JSON.parse` can handle.
 *
 * Rules:
 *   - Comments inside string literals are preserved verbatim.
 *   - Escaped quotes (\" and \') inside strings don't terminate.
 *   - Does NOT handle block comments — the RBAC template only uses
 *     line comments and supporting them would complicate the parser
 *     without clear benefit.
 *
 * Used by the RBAC page's Policy tab on every save: the user types
 * into a textarea that shows the commented template, we strip the
 * comments, JSON.parse the result, then POST the clean object to
 * `PUT /api/policies/role/:roleName`.
 */
export function stripJsonComments(jsonc: string): string {
  let out = "";
  let inString = false;
  let stringQuote: string | null = null;
  let escape = false;

  for (let i = 0; i < jsonc.length; i++) {
    const c = jsonc[i];
    const next = jsonc[i + 1];

    if (inString) {
      out += c;
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === stringQuote) {
        inString = false;
        stringQuote = null;
      }
      continue;
    }

    if (c === '"' || c === "'") {
      inString = true;
      stringQuote = c;
      out += c;
      continue;
    }

    if (c === "/" && next === "/") {
      // Skip until newline.
      while (i < jsonc.length && jsonc[i] !== "\n") i++;
      if (i < jsonc.length) out += "\n";
      continue;
    }

    out += c;
  }

  return out;
}

/**
 * Convenience — parses a JSONC string directly into an object. Throws
 * with a human-readable message on either strip or parse failure.
 */
export function parseJsonc<T = unknown>(jsonc: string): T {
  try {
    const stripped = stripJsonComments(jsonc);
    return JSON.parse(stripped) as T;
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Invalid JSONC payload",
    );
  }
}
