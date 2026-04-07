/**
 * Local Providers — LM Studio, llama.cpp
 *
 * Note: Ollama is in popular.ts (tagged both "popular" and "local").
 */

import type { CatalogProvider } from "./types";

export const LOCAL_PROVIDERS: CatalogProvider[] = [
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
