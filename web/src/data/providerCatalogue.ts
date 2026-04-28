/**
 * Curated provider + model catalogue for the web dashboard.
 *
 * Ported from `gui/src/pages/AddNewModel/configs/providers.ts` +
 * `models.ts`, trimmed to the 12 providers most orgs actually use
 * and a handful of top models per provider. The full 1,297-line
 * gui config is overkill for a settings page — if a user needs
 * a niche provider, they can edit the assistant YAML by hand on
 * `/settings/assistant`.
 *
 * Shape intentionally matches what `/api/me/providers` expects so
 * the same structure flows straight into `PUT /api/me/providers/:slug`
 * and `PUT /api/me/assistants/default` bodies.
 */

export interface CatalogueModel {
  /** Model slug as used by the upstream provider. */
  model: string;
  /** Human-readable label shown in the dropdown. */
  displayName: string;
  /** Short description under the dropdown label. */
  description?: string;
  /** Context window in tokens (for UI only — the proxy re-measures). */
  contextLength?: number;
  /** Roles this model is good at — one or more of chat, edit, apply, autocomplete, embed, rerank. */
  roles?: Array<"chat" | "edit" | "apply" | "autocomplete" | "embed" | "rerank">;
}

export const ALL_ROLES: Array<CatalogueModel["roles"] extends (infer T)[] | undefined ? T : never> =
  ["chat", "edit", "apply", "autocomplete", "embed", "rerank"];

export interface CatalogueProvider {
  /** Slug used in `/api/me/providers/:slug` and in assistant YAML. */
  slug: string;
  /** Human-readable name shown in the dropdown. */
  title: string;
  /** One-line description shown as the provider's subtitle. */
  description: string;
  /** Where to get an API key (link rendered under the key field). */
  apiKeyUrl?: string;
  /** Placeholder format for the API key input. */
  keyPlaceholder?: string;
  /** Client-side sanity check for the key format. */
  keyPattern?: RegExp;
  /** Optional base URL if the user runs a self-hosted deployment. */
  defaultBaseUrl?: string;
  /** Whether a base URL is required (e.g. Ollama, Azure). */
  requiresBaseUrl?: boolean;
  /** Whether this provider needs an API key at all (Ollama does not). */
  requiresApiKey?: boolean;
  /** Whether this provider is "popular" — shown first in the dropdown. */
  popular?: boolean;
  /** Hand-picked models we know work well with AI Firewall's scanner pipeline. */
  models: CatalogueModel[];
}

export const PROVIDER_CATALOGUE: CatalogueProvider[] = [
  {
    slug: "openai",
    title: "OpenAI",
    description: "GPT-4o, GPT-4 Turbo, GPT-3.5, and any OpenAI model",
    apiKeyUrl: "https://platform.openai.com/account/api-keys",
    keyPlaceholder: "sk-…",
    keyPattern: /^sk-.{20,}$/,
    requiresApiKey: true,
    popular: true,
    models: [
      {
        model: "gpt-4o",
        displayName: "GPT-4o",
        description: "Flagship multimodal model",
        contextLength: 128000,
        roles: ["chat", "edit", "apply"],
      },
      {
        model: "gpt-4o-mini",
        displayName: "GPT-4o Mini",
        description: "Faster, cheaper variant",
        contextLength: 128000,
        roles: ["chat", "autocomplete"],
      },
      {
        model: "gpt-4-turbo",
        displayName: "GPT-4 Turbo",
        description: "Previous flagship",
        contextLength: 128000,
        roles: ["chat", "edit"],
      },
      {
        model: "gpt-3.5-turbo",
        displayName: "GPT-3.5 Turbo",
        description: "Cheapest option",
        contextLength: 16385,
        roles: ["chat"],
      },
      {
        model: "o1",
        displayName: "o1",
        description: "Reasoning model",
        contextLength: 200000,
        roles: ["chat"],
      },
    ],
  },
  {
    slug: "anthropic",
    title: "Anthropic (Claude)",
    description: "Claude 4.5 Sonnet, Opus, and Haiku",
    apiKeyUrl: "https://console.anthropic.com/account/keys",
    keyPlaceholder: "sk-ant-…",
    keyPattern: /^sk-ant-.{20,}$/,
    requiresApiKey: true,
    popular: true,
    models: [
      {
        model: "claude-sonnet-4-5-20250929",
        displayName: "Claude 4.5 Sonnet",
        description: "Best balance of quality and speed",
        contextLength: 200000,
        roles: ["chat", "edit", "apply"],
      },
      {
        model: "claude-opus-4-1-20250805",
        displayName: "Claude 4.1 Opus",
        description: "Most capable, slowest",
        contextLength: 200000,
        roles: ["chat", "edit"],
      },
      {
        model: "claude-haiku-4-5-20251001",
        displayName: "Claude 4.5 Haiku",
        description: "Fastest, cheapest",
        contextLength: 200000,
        roles: ["chat", "autocomplete"],
      },
      {
        model: "claude-3-5-sonnet-20241022",
        displayName: "Claude 3.5 Sonnet",
        description: "Legacy flagship",
        contextLength: 200000,
        roles: ["chat", "edit"],
      },
    ],
  },
  {
    slug: "gemini",
    title: "Google Gemini",
    description: "Gemini 2.5 Pro, Flash, and earlier Gemini models",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    keyPlaceholder: "AI key from AI Studio",
    keyPattern: /^[A-Za-z0-9_-]{20,}$/,
    requiresApiKey: true,
    popular: true,
    models: [
      {
        model: "gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
        description: "Flagship with long context",
        contextLength: 2000000,
        roles: ["chat", "edit", "apply"],
      },
      {
        model: "gemini-2.5-flash",
        displayName: "Gemini 2.5 Flash",
        description: "Fast and cheap",
        contextLength: 1000000,
        roles: ["chat", "autocomplete"],
      },
      {
        model: "gemini-1.5-pro",
        displayName: "Gemini 1.5 Pro",
        description: "Previous generation",
        contextLength: 2000000,
        roles: ["chat", "edit"],
      },
    ],
  },
  {
    slug: "mistral",
    title: "Mistral",
    description: "Mistral Large, Codestral, and Mixtral",
    apiKeyUrl: "https://console.mistral.ai/api-keys/",
    keyPlaceholder: "Mistral API key",
    keyPattern: /^[A-Za-z0-9]{20,}$/,
    requiresApiKey: true,
    popular: true,
    models: [
      {
        model: "mistral-large-latest",
        displayName: "Mistral Large",
        description: "Flagship open-weights model",
        contextLength: 128000,
        roles: ["chat", "edit"],
      },
      {
        model: "codestral-latest",
        displayName: "Codestral",
        description: "Code-specialized",
        contextLength: 32768,
        roles: ["chat", "autocomplete", "apply"],
      },
      {
        model: "mistral-small-latest",
        displayName: "Mistral Small",
        description: "Cheap and fast",
        contextLength: 32768,
        roles: ["chat"],
      },
    ],
  },
  {
    slug: "ollama",
    title: "Ollama (local)",
    description: "Run models locally on your machine — no key needed",
    defaultBaseUrl: "http://localhost:11434",
    requiresBaseUrl: true,
    requiresApiKey: false,
    popular: true,
    models: [
      {
        model: "llama3.1:8b",
        displayName: "Llama 3.1 8B",
        description: "Balanced general-purpose",
        contextLength: 128000,
        roles: ["chat"],
      },
      {
        model: "llama3.1:70b",
        displayName: "Llama 3.1 70B",
        description: "Highest quality (requires GPU)",
        contextLength: 128000,
        roles: ["chat", "edit"],
      },
      {
        model: "qwen2.5-coder:7b",
        displayName: "Qwen 2.5 Coder 7B",
        description: "Code-specialized",
        contextLength: 32768,
        roles: ["chat", "autocomplete", "apply"],
      },
      {
        model: "deepseek-coder-v2:16b",
        displayName: "DeepSeek Coder v2 16B",
        description: "High-quality code model",
        contextLength: 128000,
        roles: ["chat", "edit"],
      },
    ],
  },
  {
    slug: "openrouter",
    title: "OpenRouter",
    description: "Proxy to 100+ models from every provider",
    apiKeyUrl: "https://openrouter.ai/keys",
    keyPlaceholder: "sk-or-v1-…",
    requiresApiKey: true,
    models: [
      {
        model: "openrouter/auto",
        displayName: "Auto",
        description: "Lets OpenRouter pick the best model",
        roles: ["chat"],
      },
      {
        model: "anthropic/claude-sonnet-4-5",
        displayName: "Claude 4.5 Sonnet (via OpenRouter)",
        roles: ["chat", "edit"],
      },
      {
        model: "openai/gpt-4o",
        displayName: "GPT-4o (via OpenRouter)",
        roles: ["chat", "edit"],
      },
    ],
  },
  {
    slug: "azure",
    title: "Azure OpenAI",
    description: "Enterprise-hosted OpenAI models via Azure",
    apiKeyUrl: "https://portal.azure.com/",
    keyPlaceholder: "Azure OpenAI API key",
    requiresApiKey: true,
    requiresBaseUrl: true,
    models: [
      {
        model: "gpt-4o",
        displayName: "GPT-4o (Azure deployment)",
        roles: ["chat", "edit"],
      },
      {
        model: "gpt-4-turbo",
        displayName: "GPT-4 Turbo (Azure deployment)",
        roles: ["chat", "edit"],
      },
    ],
  },
  {
    slug: "bedrock",
    title: "AWS Bedrock",
    description: "Anthropic, Llama, and Mistral models via AWS",
    apiKeyUrl: "https://docs.aws.amazon.com/bedrock/latest/userguide/setup.html",
    keyPlaceholder: "AWS access key",
    requiresApiKey: true,
    requiresBaseUrl: true,
    models: [
      {
        model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
        displayName: "Claude 3.5 Sonnet (Bedrock)",
        roles: ["chat", "edit"],
      },
      {
        model: "meta.llama3-1-70b-instruct-v1:0",
        displayName: "Llama 3.1 70B (Bedrock)",
        roles: ["chat"],
      },
    ],
  },
  {
    slug: "deepseek",
    title: "DeepSeek",
    description: "DeepSeek V3 and DeepSeek Coder V2",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    keyPlaceholder: "DeepSeek API key",
    requiresApiKey: true,
    models: [
      {
        model: "deepseek-chat",
        displayName: "DeepSeek V3",
        description: "General chat",
        contextLength: 64000,
        roles: ["chat"],
      },
      {
        model: "deepseek-coder",
        displayName: "DeepSeek Coder V2",
        description: "Code-specialized",
        contextLength: 128000,
        roles: ["chat", "autocomplete", "apply"],
      },
    ],
  },
  {
    slug: "groq",
    title: "Groq",
    description: "Ultra-fast inference on open-weights models",
    apiKeyUrl: "https://console.groq.com/keys",
    keyPlaceholder: "gsk_…",
    requiresApiKey: true,
    models: [
      {
        model: "llama-3.1-70b-versatile",
        displayName: "Llama 3.1 70B Versatile",
        roles: ["chat"],
      },
      {
        model: "llama-3.1-8b-instant",
        displayName: "Llama 3.1 8B Instant",
        description: "Very fast responses",
        roles: ["chat", "autocomplete"],
      },
      {
        model: "mixtral-8x7b-32768",
        displayName: "Mixtral 8x7B",
        roles: ["chat"],
      },
    ],
  },
  {
    slug: "cohere",
    title: "Cohere",
    description: "Command R+ and Command R",
    apiKeyUrl: "https://dashboard.cohere.com/api-keys",
    keyPlaceholder: "Cohere API key",
    requiresApiKey: true,
    models: [
      {
        model: "command-r-plus",
        displayName: "Command R+",
        description: "Flagship",
        roles: ["chat", "edit"],
      },
      {
        model: "command-r",
        displayName: "Command R",
        description: "Cheaper",
        roles: ["chat"],
      },
    ],
  },
  {
    slug: "xai",
    title: "xAI (Grok)",
    description: "Grok models",
    apiKeyUrl: "https://console.x.ai/",
    keyPlaceholder: "xAI API key",
    requiresApiKey: true,
    models: [
      {
        model: "grok-2-latest",
        displayName: "Grok 2",
        roles: ["chat"],
      },
      {
        model: "grok-beta",
        displayName: "Grok Beta",
        roles: ["chat"],
      },
    ],
  },
  {
    slug: "custom",
    title: "Custom / OpenAI Compatible",
    description: "Connect to any OpenAI-compatible API (NVIDIA, Groq, vLLM, etc.)",
    requiresApiKey: true,
    requiresBaseUrl: true,
    models: [],
  },
];

/** Popular providers shown first in the dropdown. */
export const POPULAR_PROVIDERS = PROVIDER_CATALOGUE.filter((p) => p.popular);

/** Remaining providers, shown below a separator. */
export const OTHER_PROVIDERS = PROVIDER_CATALOGUE.filter((p) => !p.popular);

/** Quick lookup by slug. */
export function findProvider(slug: string): CatalogueProvider | undefined {
  return PROVIDER_CATALOGUE.find((p) => p.slug === slug);
}
