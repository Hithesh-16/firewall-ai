/**
 * Phase C.C6 (SECURITY_HARDENING_PLAN.md) — `apiKey:` value
 * classifier. Extracted into its own module with zero transitive
 * dependencies so it can be unit-tested without dragging in the
 * full YAML loader stack (which transitively requires `mssql`,
 * `sqlite`, etc.).
 *
 * The classifier decides whether a model's `apiKey:` value is a
 * plain-text leak (rejected by the loader) or one of the four
 * acceptable indirection shapes:
 *
 *   - empty / undefined         → no key (Ollama-style local)
 *   - `vault://<slug>`          → vault reference; resolved by C3
 *   - `${{ secrets.X }}`        → assistant-template secret input
 *   - `${ENV_VAR}` / `$ENV_VAR` → env-var indirection
 *
 * Anything else is a literal key value and refused.
 */

const ENV_VAR_NAME = /^\$[A-Z_][A-Z0-9_]*$/;

export function isPlaintextApiKey(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("vault://")) return false;
  if (trimmed.startsWith("${{")) return false;
  if (trimmed.startsWith("${")) return false;
  if (trimmed.startsWith("$") && ENV_VAR_NAME.test(trimmed)) return false;
  return true;
}
