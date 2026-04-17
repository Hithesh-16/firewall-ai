/**
 * Unified `provider:model-id` resolver — Phase I.I1
 * (SECURITY_HARDENING_PLAN.md).
 *
 * Parses model identifiers in the `provider:model` format used by
 * LangChain deepagents (`openai:gpt-4o`, `anthropic:claude-sonnet-4-6`,
 * `ollama:llama3.1:8b`) and resolves them to the concrete provider
 * name + model name that the existing LLMClasses registry expects.
 *
 * Why this lives in the proxy (not core): the proxy is the boundary
 * where an inbound HTTP request (`POST /v1/chat/completions { model:
 * "openai:gpt-4o" }`) is resolved to a provider class + vault lookup.
 * Core only sees the resolved `providerName` + `model` fields at
 * construction time.
 *
 * Design:
 *   - `parseModelId("openai:gpt-4o")` → `{ provider: "openai", model: "gpt-4o" }`
 *   - `parseModelId("gpt-4o")` → `{ provider: undefined, model: "gpt-4o" }` (bare model, no prefix)
 *   - `parseModelId("ollama:llama3.1:8b")` → `{ provider: "ollama", model: "llama3.1:8b" }` (Ollama model tags contain `:`)
 *   - `resolveModel("openai:gpt-4o")` → `{ provider: "openai", model: "gpt-4o", resolved: true }` (provider validated against known set)
 *
 * The set of known providers is built from the LLMClasses registry
 * in core — proxied here as a static set so we don't import the
 * full core into the proxy's hot path.
 *
 * SOLID:
 *   - SRP: parsing + resolution only. No vault, no HTTP, no LLM instantiation.
 *   - OCP: new providers added to KNOWN_PROVIDERS without touching callers.
 */

// ── Known provider slugs ────────────────────────────────────────
//
// Sourced from `core/llm/llms/*.ts` `static providerName` fields.
// Kept as a flat set so the resolver is dependency-free and fast.
// When a new provider class is added to core, add its slug here.
const KNOWN_PROVIDERS = new Set<string>([
  "anthropic",
  "asksage",
  "azure",
  "bedrock",
  "bedrockimport",
  "cerebras",
  "cloudflare",
  "cohere",
  "cometapi",
  "deepinfra",
  "deepseek",
  "docker",
  "fireworks",
  "flowise",
  "function-network",
  "gemini",
  "groq",
  "huggingface-inference-api",
  "huggingface-tei",
  "huggingface-tgi",
  "inception",
  "kindo",
  "lemonade",
  "llama.cpp",
  "llamafile",
  "llamastack",
  "lmstudio",
  "mimo",
  "mistral",
  "mock",
  "moonshot",
  "msty",
  "ncompass",
  "novita",
  "nvidia",
  "ollama",
  "openai",
  "openrouter",
  "ovhcloud",
  "replicate",
  "sagemaker",
  "sambanova",
  "scaleway",
  "siliconflow",
  "tars",
  "test",
  "text-gen-webui",
  "together",
  "venice",
  "vertexai",
  "vllm",
  "voyage",
  "watsonx",
  "xai",
  "zai",
]);

// ── Aliases ─────────────────────────────────────────────────────
//
// Common short-hands used in deepagents / Claude Code / community
// configs that should resolve to the canonical `providerName`.
const ALIASES: Record<string, string> = {
  google: "gemini",
  google_genai: "gemini",
  "google-genai": "gemini",
  gpt: "openai",
  claude: "anthropic",
  llama: "ollama",
  huggingface: "huggingface-inference-api",
  hf: "huggingface-inference-api",
  aws: "bedrock",
  vertex: "vertexai",
  "vertex-ai": "vertexai",
  ibm: "watsonx",
  cf: "cloudflare",
  silicon: "siliconflow",
};

// ── Public types ────────────────────────────────────────────────

export interface ParsedModelId {
  /** Provider slug if the input contained a `:` prefix, else undefined. */
  provider: string | undefined;
  /** Model name (everything after the first `:`). */
  model: string;
  /** True if the provider was found in KNOWN_PROVIDERS or ALIASES. */
  resolved: boolean;
}

// ── Parser ──────────────────────────────────────────────────────

/**
 * Parse a `provider:model` string.
 *
 * The tricky bit is Ollama model tags like `llama3.1:8b` which
 * contain a colon that is NOT a provider separator. We handle this
 * by checking whether the text before the first colon is a known
 * provider (or alias). If it is, we split there. If not, the whole
 * string is the model and the provider is undefined.
 */
export function parseModelId(input: string): ParsedModelId {
  const trimmed = input.trim();
  if (!trimmed) {
    return { provider: undefined, model: "", resolved: false };
  }

  const colonIdx = trimmed.indexOf(":");
  if (colonIdx <= 0) {
    // No colon at all, or colon at position 0 (":model" — treat as bare model).
    return { provider: undefined, model: trimmed, resolved: false };
  }

  const prefix = trimmed.slice(0, colonIdx).toLowerCase();
  const rest = trimmed.slice(colonIdx + 1);

  // Check known providers + aliases.
  const canonical =
    ALIASES[prefix] ?? (KNOWN_PROVIDERS.has(prefix) ? prefix : undefined);
  if (canonical) {
    return { provider: canonical, model: rest, resolved: true };
  }

  // Not a known provider — treat the whole string as a bare model.
  // This handles `llama3.1:8b` where "llama3.1" is not a provider.
  return { provider: undefined, model: trimmed, resolved: false };
}

/**
 * Convenience: resolve model id and return the canonical provider
 * name + model. Falls back to the org default provider if the input
 * is a bare model with no prefix.
 */
export function resolveModelId(
  input: string,
  defaultProvider?: string,
): { provider: string; model: string } {
  const parsed = parseModelId(input);
  return {
    provider: parsed.provider ?? defaultProvider ?? "openai",
    model: parsed.model,
  };
}

/**
 * Check whether a string looks like a `provider:model` identifier
 * (as opposed to a bare model name). Useful for gateway routes that
 * want to decide whether to run the resolver or pass through.
 */
export function isProviderPrefixed(input: string): boolean {
  return parseModelId(input).resolved;
}

/**
 * List all known provider slugs + aliases. Useful for the GUI's
 * model picker dropdown and the CLI's `/model` tab completion.
 */
export function listKnownProviders(): string[] {
  return [...KNOWN_PROVIDERS].sort();
}

export function listAliases(): Record<string, string> {
  return { ...ALIASES };
}
