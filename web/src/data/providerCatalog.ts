/**
 * Provider Catalog
 *
 * Static catalog of supported AI providers with their default
 * base URLs, icons, popular models, and API key links.
 * Mirrors the VS Code extension's provider list.
 */

export interface CatalogModel {
  id: string;
  name: string;
  contextLength: number;
  inputCostPer1k?: number;
  outputCostPer1k?: number;
}

export interface CatalogProvider {
  id: string;
  name: string;
  icon: string;
  description: string;
  baseUrl: string;
  apiKeyUrl?: string;
  requiresApiKey: boolean;
  isLocal?: boolean;
  models: CatalogModel[];
  tags: string[];
}

export const PROVIDER_CATALOG: CatalogProvider[] = [
  // ── Popular ──
  {
    id: "openai",
    name: "OpenAI",
    icon: "openai.png",
    description: "GPT-5, GPT-4o, o3, o4-mini and more",
    baseUrl: "https://api.openai.com/v1",
    apiKeyUrl: "https://platform.openai.com/account/api-keys",
    requiresApiKey: true,
    tags: ["popular"],
    models: [
      {
        id: "gpt-4o",
        name: "GPT-4o",
        contextLength: 128000,
        inputCostPer1k: 0.0025,
        outputCostPer1k: 0.01,
      },
      {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        contextLength: 128000,
        inputCostPer1k: 0.00015,
        outputCostPer1k: 0.0006,
      },
      {
        id: "gpt-4-turbo",
        name: "GPT-4 Turbo",
        contextLength: 128000,
        inputCostPer1k: 0.01,
        outputCostPer1k: 0.03,
      },
      {
        id: "o3",
        name: "o3",
        contextLength: 200000,
        inputCostPer1k: 0.01,
        outputCostPer1k: 0.04,
      },
      {
        id: "o4-mini",
        name: "o4-mini",
        contextLength: 200000,
        inputCostPer1k: 0.0011,
        outputCostPer1k: 0.0044,
      },
      {
        id: "gpt-4.1",
        name: "GPT-4.1",
        contextLength: 1047576,
        inputCostPer1k: 0.002,
        outputCostPer1k: 0.008,
      },
      {
        id: "gpt-4.1-mini",
        name: "GPT-4.1 Mini",
        contextLength: 1047576,
        inputCostPer1k: 0.0004,
        outputCostPer1k: 0.0016,
      },
      {
        id: "gpt-3.5-turbo",
        name: "GPT-3.5 Turbo",
        contextLength: 16385,
        inputCostPer1k: 0.0005,
        outputCostPer1k: 0.0015,
      },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    icon: "anthropic.png",
    description: "Claude Opus, Sonnet, and Haiku models",
    baseUrl: "https://api.anthropic.com",
    apiKeyUrl: "https://console.anthropic.com/account/keys",
    requiresApiKey: true,
    tags: ["popular"],
    models: [
      {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        contextLength: 200000,
        inputCostPer1k: 0.015,
        outputCostPer1k: 0.075,
      },
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        contextLength: 200000,
        inputCostPer1k: 0.003,
        outputCostPer1k: 0.015,
      },
      {
        id: "claude-4.5-sonnet",
        name: "Claude 4.5 Sonnet",
        contextLength: 200000,
        inputCostPer1k: 0.003,
        outputCostPer1k: 0.015,
      },
      {
        id: "claude-4.5-haiku",
        name: "Claude 4.5 Haiku",
        contextLength: 200000,
        inputCostPer1k: 0.0008,
        outputCostPer1k: 0.004,
      },
      {
        id: "claude-4.1-opus",
        name: "Claude 4.1 Opus",
        contextLength: 200000,
        inputCostPer1k: 0.015,
        outputCostPer1k: 0.075,
      },
      {
        id: "claude-4-sonnet",
        name: "Claude 4 Sonnet",
        contextLength: 200000,
        inputCostPer1k: 0.003,
        outputCostPer1k: 0.015,
      },
    ],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    icon: "gemini.png",
    description: "Gemini 2.5 Pro, Flash, and more",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    requiresApiKey: true,
    tags: ["popular"],
    models: [
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        contextLength: 1048576,
        inputCostPer1k: 0.00125,
        outputCostPer1k: 0.01,
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        contextLength: 1048576,
        inputCostPer1k: 0.00015,
        outputCostPer1k: 0.0006,
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        contextLength: 1048576,
        inputCostPer1k: 0.0001,
        outputCostPer1k: 0.0004,
      },
    ],
  },
  {
    id: "mistral",
    name: "Mistral",
    icon: "mistral.png",
    description: "Mistral Large, Medium, and Codestral",
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyUrl: "https://console.mistral.ai/api-keys/",
    requiresApiKey: true,
    tags: ["popular"],
    models: [
      {
        id: "mistral-large-latest",
        name: "Mistral Large",
        contextLength: 128000,
        inputCostPer1k: 0.002,
        outputCostPer1k: 0.006,
      },
      {
        id: "mistral-medium-latest",
        name: "Mistral Medium",
        contextLength: 32000,
        inputCostPer1k: 0.0027,
        outputCostPer1k: 0.0081,
      },
      {
        id: "codestral-latest",
        name: "Codestral",
        contextLength: 32000,
        inputCostPer1k: 0.001,
        outputCostPer1k: 0.003,
      },
      {
        id: "mistral-small-latest",
        name: "Mistral Small",
        contextLength: 32000,
        inputCostPer1k: 0.001,
        outputCostPer1k: 0.003,
      },
    ],
  },
  // ── Cloud Providers ──
  {
    id: "openrouter",
    name: "OpenRouter",
    icon: "openrouter.png",
    description: "Access 100+ models through a single API",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyUrl: "https://openrouter.ai/settings/keys",
    requiresApiKey: true,
    tags: ["popular"],
    models: [
      {
        id: "openai/gpt-4o",
        name: "GPT-4o (via OpenRouter)",
        contextLength: 128000,
      },
      {
        id: "anthropic/claude-3.5-sonnet",
        name: "Claude 3.5 Sonnet (via OpenRouter)",
        contextLength: 200000,
      },
      {
        id: "google/gemini-2.5-pro",
        name: "Gemini 2.5 Pro (via OpenRouter)",
        contextLength: 1048576,
      },
      {
        id: "meta-llama/llama-3.1-70b-instruct",
        name: "Llama 3.1 70B",
        contextLength: 131072,
      },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    icon: "deepseek.png",
    description: "DeepSeek Chat and Reasoner models",
    baseUrl: "https://api.deepseek.com/v1",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    requiresApiKey: true,
    tags: ["cloud"],
    models: [
      {
        id: "deepseek-chat",
        name: "DeepSeek Chat",
        contextLength: 128000,
        inputCostPer1k: 0.00014,
        outputCostPer1k: 0.00028,
      },
      {
        id: "deepseek-reasoner",
        name: "DeepSeek Reasoner",
        contextLength: 128000,
        inputCostPer1k: 0.00055,
        outputCostPer1k: 0.0022,
      },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    icon: "groq.png",
    description: "Ultra-fast inference for open-source models",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyUrl: "https://console.groq.com/keys",
    requiresApiKey: true,
    tags: ["cloud"],
    models: [
      {
        id: "llama-3.3-70b-versatile",
        name: "Llama 3.3 70B",
        contextLength: 131072,
      },
      {
        id: "llama-3.1-8b-instant",
        name: "Llama 3.1 8B",
        contextLength: 131072,
      },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", contextLength: 32768 },
    ],
  },
  {
    id: "together",
    name: "Together AI",
    icon: "together.png",
    description: "Run open-source models with fast inference",
    baseUrl: "https://api.together.xyz/v1",
    apiKeyUrl: "https://api.together.xyz/settings/api-keys",
    requiresApiKey: true,
    tags: ["cloud"],
    models: [
      {
        id: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
        name: "Llama 3.1 70B Turbo",
        contextLength: 131072,
      },
      {
        id: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
        name: "Llama 3.1 8B Turbo",
        contextLength: 131072,
      },
      {
        id: "mistralai/Mixtral-8x7B-Instruct-v0.1",
        name: "Mixtral 8x7B",
        contextLength: 32768,
      },
    ],
  },
  {
    id: "azure",
    name: "Azure OpenAI",
    icon: "azure.png",
    description: "OpenAI models hosted on Microsoft Azure",
    baseUrl: "https://{resource}.openai.azure.com",
    apiKeyUrl: "https://portal.azure.com/",
    requiresApiKey: true,
    tags: ["enterprise"],
    models: [
      { id: "gpt-4o", name: "GPT-4o (Azure)", contextLength: 128000 },
      { id: "gpt-4", name: "GPT-4 (Azure)", contextLength: 128000 },
      {
        id: "gpt-35-turbo",
        name: "GPT-3.5 Turbo (Azure)",
        contextLength: 16385,
      },
    ],
  },
  {
    id: "cohere",
    name: "Cohere",
    icon: "cohere.png",
    description: "Command R+ and Command models",
    baseUrl: "https://api.cohere.ai/v1",
    apiKeyUrl: "https://dashboard.cohere.ai/api-keys",
    requiresApiKey: true,
    tags: ["cloud"],
    models: [
      { id: "command-r-plus", name: "Command R+", contextLength: 128000 },
      { id: "command-r", name: "Command R", contextLength: 128000 },
    ],
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    icon: "fireworks.png",
    description: "Fast inference for open-source models",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    apiKeyUrl: "https://fireworks.ai/api-keys",
    requiresApiKey: true,
    tags: ["cloud"],
    models: [
      {
        id: "accounts/fireworks/models/llama-v3p1-70b-instruct",
        name: "Llama 3.1 70B",
        contextLength: 131072,
      },
      {
        id: "accounts/fireworks/models/mixtral-8x7b-instruct",
        name: "Mixtral 8x7B",
        contextLength: 32768,
      },
    ],
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    icon: "nvidia.png",
    description: "NVIDIA-optimized model inference",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKeyUrl: "https://build.nvidia.com/",
    requiresApiKey: true,
    tags: ["enterprise"],
    models: [
      {
        id: "meta/llama-3.1-70b-instruct",
        name: "Llama 3.1 70B",
        contextLength: 131072,
      },
      {
        id: "meta/llama-3.1-8b-instruct",
        name: "Llama 3.1 8B",
        contextLength: 131072,
      },
    ],
  },
  {
    id: "cerebras",
    name: "Cerebras",
    icon: "cerebras.png",
    description: "World's fastest AI inference",
    baseUrl: "https://api.cerebras.ai/v1",
    apiKeyUrl: "https://cloud.cerebras.ai/",
    requiresApiKey: true,
    tags: ["cloud"],
    models: [
      { id: "llama3.1-70b", name: "Llama 3.1 70B", contextLength: 131072 },
      { id: "llama3.1-8b", name: "Llama 3.1 8B", contextLength: 131072 },
    ],
  },
  {
    id: "sambanova",
    name: "SambaNova",
    icon: "sambanova.png",
    description: "Enterprise AI inference platform",
    baseUrl: "https://api.sambanova.ai/v1",
    apiKeyUrl: "https://cloud.sambanova.ai/apis",
    requiresApiKey: true,
    tags: ["enterprise"],
    models: [
      {
        id: "Meta-Llama-3.1-70B-Instruct",
        name: "Llama 3.1 70B",
        contextLength: 131072,
      },
    ],
  },
  {
    id: "replicate",
    name: "Replicate",
    icon: "replicate.png",
    description: "Run open-source models in the cloud",
    baseUrl: "https://api.replicate.com/v1",
    apiKeyUrl: "https://replicate.com/account/api-tokens",
    requiresApiKey: true,
    tags: ["cloud"],
    models: [
      {
        id: "meta/meta-llama-3-70b-instruct",
        name: "Llama 3 70B",
        contextLength: 8192,
      },
    ],
  },
  // ── Local ──
  {
    id: "ollama",
    name: "Ollama",
    icon: "ollama.png",
    description: "Run models locally — no API key needed",
    baseUrl: "http://localhost:11434",
    requiresApiKey: false,
    isLocal: true,
    tags: ["popular", "local"],
    models: [
      { id: "llama3.1:70b", name: "Llama 3.1 70B", contextLength: 131072 },
      { id: "llama3.1:8b", name: "Llama 3.1 8B", contextLength: 131072 },
      { id: "codellama:34b", name: "Code Llama 34B", contextLength: 16384 },
      { id: "mistral:7b", name: "Mistral 7B", contextLength: 32768 },
      {
        id: "deepseek-coder-v2:16b",
        name: "DeepSeek Coder V2 16B",
        contextLength: 128000,
      },
      {
        id: "qwen2.5-coder:7b",
        name: "Qwen 2.5 Coder 7B",
        contextLength: 32768,
      },
    ],
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    icon: "lmstudio.png",
    description: "Run models locally via LM Studio",
    baseUrl: "http://localhost:1234/v1",
    requiresApiKey: false,
    isLocal: true,
    tags: ["local"],
    models: [
      {
        id: "loaded-model",
        name: "Currently Loaded Model",
        contextLength: 4096,
      },
    ],
  },
  {
    id: "llamacpp",
    name: "llama.cpp",
    icon: "llamacpp.png",
    description: "Run GGUF models locally with llama.cpp",
    baseUrl: "http://localhost:8080",
    requiresApiKey: false,
    isLocal: true,
    tags: ["local"],
    models: [{ id: "default", name: "Loaded Model", contextLength: 4096 }],
  },
];

/** Subset of popular providers shown first in the UI */
export const POPULAR_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "gemini",
  "mistral",
  "openrouter",
  "ollama",
];
