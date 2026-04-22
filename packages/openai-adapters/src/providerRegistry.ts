export interface ProviderDefinition {
  provider: string;
  apiBase: string;
}

export const PROVIDER_REGISTRY: ProviderDefinition[] = [
  { provider: "xAI", apiBase: "https://api.x.ai/v1/" },
  { provider: "zAI", apiBase: "https://api.z.ai/api/paas/v4/" },
  { provider: "voyage", apiBase: "https://api.voyageai.com/v1/" },
  { provider: "mistral", apiBase: "https://api.mistral.ai/v1/" },
  { provider: "deepinfra", apiBase: "https://api.deepinfra.com/v1/openai/" },
  { provider: "vllm", apiBase: "http://localhost:8000/v1/" },
  { provider: "groq", apiBase: "https://api.groq.com/openai/v1/" },
  { provider: "sambanova", apiBase: "https://api.sambanova.ai/v1/" },
  { provider: "text-gen-webui", apiBase: "http://127.0.0.1:5000/v1/" },
  { provider: "cerebras", apiBase: "https://api.cerebras.ai/v1/" },
  { provider: "kindo", apiBase: "https://llm.kindo.ai/v1/" },
  { provider: "msty", apiBase: "http://localhost:10000" },
  { provider: "nvidia", apiBase: "https://integrate.api.nvidia.com/v1/" },
  {
    provider: "ovhcloud",
    apiBase: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/",
  },
  { provider: "scaleway", apiBase: "https://api.scaleway.ai/v1/" },
  { provider: "fireworks", apiBase: "https://api.fireworks.ai/inference/v1/" },
  { provider: "together", apiBase: "https://api.together.xyz/v1/" },
  { provider: "ncompass", apiBase: "https://api.ncompass.tech/v1" },
  { provider: "novita", apiBase: "https://api.novita.ai/v3/openai" },
  { provider: "nebius", apiBase: "https://api.studio.nebius.ai/v1/" },
  { provider: "function-network", apiBase: "https://api.function.network/v1/" },
  { provider: "llama.cpp", apiBase: "http://localhost:8000/" },
  { provider: "llamafile", apiBase: "http://localhost:8000/" },
  { provider: "lmstudio", apiBase: "http://localhost:1234/" },
  { provider: "ollama", apiBase: "http://localhost:11434/v1/" },
];

export function getApiBaseForProvider(provider: string): string | undefined {
  return PROVIDER_REGISTRY.find((p) => p.provider === provider)?.apiBase;
}
