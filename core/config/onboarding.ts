import { ConfigYaml } from "@ai-firewall/config-yaml";

export const LOCAL_ONBOARDING_PROVIDER_TITLE = "Ollama";
export const LOCAL_ONBOARDING_FIM_MODEL = "qwen2.5-coder:1.5b-base";
export const LOCAL_ONBOARDING_FIM_TITLE = "Qwen2.5-Coder 1.5B";
export const LOCAL_ONBOARDING_CHAT_MODEL = "llama3.1:8b";
export const LOCAL_ONBOARDING_CHAT_TITLE = "Llama 3.1 8B";
export const LOCAL_ONBOARDING_EMBEDDINGS_MODEL = "nomic-embed-text:latest";
export const LOCAL_ONBOARDING_EMBEDDINGS_TITLE = "Nomic Embed";

/**
 * Concrete model entries seeded by the onboarding wizard for each
 * hosted provider. Each entry is written DIRECTLY to config.yaml
 * with `provider + model + apiKeyRef` instead of the previous
 * `uses: <hub-slug> + with: { OPENAI_API_KEY: apiKey }` pair —
 * the previous shape leaked the plaintext key into the YAML, which
 * Phase C of SECURITY_HARDENING_PLAN.md eliminates.
 *
 * Defaults intentionally kept narrow (one model per provider) so the
 * onboarding YAML stays readable; users can add more from the
 * /settings/models surface afterwards.
 */
const ANTHROPIC_MODEL_DEFAULTS = [
  { name: "Claude Sonnet", model: "claude-sonnet-4-20250514" },
];
const OPENAI_MODEL_DEFAULTS = [{ name: "GPT-4.1", model: "gpt-4.1" }];
const GEMINI_MODEL_DEFAULTS = [
  { name: "Gemini 2.5 Pro", model: "gemini-2.5-pro" },
];

/**
 * We set the "best" chat + autocopmlete models by default
 * whenever a user doesn't have a config.json
 */
export function setupBestConfig(config: ConfigYaml): ConfigYaml {
  return {
    ...config,
    models: config.models,
  };
}

export function setupLocalConfig(config: ConfigYaml): ConfigYaml {
  return {
    ...config,
    models: [
      {
        name: LOCAL_ONBOARDING_CHAT_TITLE,
        provider: "ollama",
        model: LOCAL_ONBOARDING_CHAT_MODEL,
        roles: ["chat", "edit", "apply"],
      },
      {
        name: LOCAL_ONBOARDING_FIM_TITLE,
        provider: "ollama",
        model: LOCAL_ONBOARDING_FIM_MODEL,
        roles: ["autocomplete"],
      },
      {
        name: LOCAL_ONBOARDING_EMBEDDINGS_TITLE,
        provider: "ollama",
        model: LOCAL_ONBOARDING_EMBEDDINGS_MODEL,
        roles: ["embed"],
      },
      ...(config.models ?? []),
    ],
  };
}

export function setupQuickstartConfig(config: ConfigYaml): ConfigYaml {
  return config;
}

/**
 * Phase C.C2 (SECURITY_HARDENING_PLAN.md) — the third arg is now an
 * `apiKeyRef` (e.g. `"vault://openai"`) produced by the upstream GUI
 * after POST'ing the actual key to the proxy vault. Onboarding writes
 * this reference into config.yaml; the BaseLLM resolver (C3) fetches
 * the real key from the proxy at instantiation. Plaintext API keys
 * are never written to disk by this code path.
 */
export function setupProviderConfig(
  config: ConfigYaml,
  provider: string,
  apiKeyRef: string,
): ConfigYaml {
  let newModels;

  switch (provider) {
    case "openai":
      newModels = OPENAI_MODEL_DEFAULTS.map((m) => ({
        name: m.name,
        provider: "openai",
        model: m.model,
        apiKeyRef,
      }));
      break;
    case "anthropic":
      newModels = ANTHROPIC_MODEL_DEFAULTS.map((m) => ({
        name: m.name,
        provider: "anthropic",
        model: m.model,
        apiKeyRef,
      }));
      break;
    case "gemini":
      newModels = GEMINI_MODEL_DEFAULTS.map((m) => ({
        name: m.name,
        provider: "gemini",
        model: m.model,
        apiKeyRef,
      }));
      break;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  return {
    ...config,
    models: [...(config.models ?? []), ...newModels],
  };
}
