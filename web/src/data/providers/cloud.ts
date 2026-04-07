/**
 * Cloud Providers — DeepSeek, Groq, Together, Azure, Cohere,
 * Fireworks, NVIDIA, Cerebras, SambaNova, Replicate
 */

import type { CatalogProvider } from "./types";

export const CLOUD_PROVIDERS: CatalogProvider[] = [
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
];
