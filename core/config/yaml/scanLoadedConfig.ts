/**
 * Plain-text-API-key detector for loaded YAML config.
 *
 * Phase A.A2 — see SECURITY_HARDENING_PLAN.md.
 *
 * Vault story (Phase C) makes the proxy vault the single source of
 * truth for every BYOK key. Until that lands, `apiKey:` may still be
 * set as a literal in `config.yaml`. This pass walks the unrolled
 * assistant after `loadConfigYaml` returns and emits a critical
 * `ScanReport` for every model whose `apiKey` field is a literal
 * value (not a `${{ secrets.X }}` reference, not a `vault://` ref,
 * not empty).
 *
 * Design constraints:
 *   - Inform, don't block (per CLAUDE.md "proxy informs, client decides").
 *     Hard refusal lives in Phase C.
 *   - Walk the parsed structure, NOT raw YAML text — raw-text scanning
 *     duplicates ScanningIde's file-level scan and produces noise on
 *     commit hashes, ENV examples in comments, etc.
 *   - Emits via `publishScanReport` so the same channel that surfaces
 *     file-scan findings carries this one too. Reports outside a
 *     `runInScanContext` block silently drop.
 */

import { scanSecrets } from "@ai-firewall/scanner";
import type { AssistantUnrolled } from "@ai-firewall/config-yaml";

import type { ScanReport } from "../../util/scanning/FileBlockedByScanError.js";
import type { FileScanFinding } from "../../util/fileScanProxy.js";
import { publishScanReport } from "../../util/scanning/scanReportChannel.js";

/**
 * Returns `true` if a model's `apiKey` value looks like a real
 * plaintext key — i.e. not a template placeholder or vault reference.
 */
function isLiteralApiKey(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // YAML interpolation syntax used by config-yaml's render pipeline.
  if (trimmed.startsWith("${{") || trimmed.startsWith("${")) return false;
  // Phase C reference shape — explicit opt-in to the vault.
  if (trimmed.startsWith("vault://")) return false;
  return true;
}

/**
 * Walk the unrolled assistant and emit one `ScanReport` per model
 * whose `apiKey` field is a literal value.
 *
 * Pure side-effect — returns the count of reports emitted so callers
 * can log it without re-walking the structure.
 */
export function scanLoadedConfigForPlaintextKeys(
  assistant: AssistantUnrolled,
  sourceFile: string,
): number {
  const models = assistant.models ?? [];
  let emitted = 0;

  for (const model of models) {
    if (!model) continue;
    const apiKey = (model as { apiKey?: string }).apiKey;
    if (!isLiteralApiKey(apiKey)) continue;

    // Run the value through the scanner so the report carries the
    // matched secret type (GROQ_KEY, ANTHROPIC_KEY, …) rather than a
    // generic "looks like a key" message.
    const secretsResult = scanSecrets(apiKey!);
    const findings: FileScanFinding[] = secretsResult.secrets.map((s) => ({
      type: s.type,
      severity: s.severity,
      category: "secret",
      // Loaded YAML — no precise line/column without re-parsing the
      // raw file. Use 0 as a sentinel; the report still pinpoints the
      // file and model name in the message.
      line: 0,
      column: 0,
      masked: redactForReport(s.value),
    }));

    // If the scanner didn't recognize the shape, still emit a report
    // — the presence of a literal `apiKey:` is the leak, regardless
    // of provider. Use a sentinel finding so the GUI banner has
    // something to render.
    if (findings.length === 0) {
      findings.push({
        type: "GENERIC_API_KEY",
        severity: "critical",
        category: "secret",
        line: 0,
        column: 0,
        masked: redactForReport(apiKey!),
      });
    }

    const modelName = (model as { name?: string }).name ?? "(unnamed)";
    const report: ScanReport = {
      filePath: sourceFile,
      action: "ALLOW",
      riskScore: 95,
      reasons: [
        `Plain-text API key detected in config.yaml model "${modelName}". ` +
          `Migrate to "apiKeyRef: vault://..." (Phase C of SECURITY_HARDENING_PLAN.md).`,
      ],
      findings,
    };

    publishScanReport(report);
    emitted += 1;
  }

  return emitted;
}

/**
 * Mask the middle of a key so the report doesn't itself become a
 * leak channel. Keeps the first 4 and last 2 chars, same convention
 * the existing scan-result banner uses (CLAUDE.md "Scan Result Display").
 */
function redactForReport(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}
