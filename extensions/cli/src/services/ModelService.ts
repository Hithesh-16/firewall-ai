import { AssistantUnrolled, ModelConfig } from "@ai-firewall/config-yaml";
import { AuthConfig } from "@ai-firewall/shared-auth";
import { syncModelToProxy } from "../util/proxyModelSync.js";

import { createLlmApi, getLlmApi } from "../config.js";
import { getModelName } from "../auth/workos.js";
import { logger } from "../util/logger.js";

import { BaseService, ServiceWithDependencies } from "./BaseService.js";
import { AgentFileServiceState, ModelServiceState } from "./types.js";

/**
 * Service for managing LLM and model state
 * Depends on auth config and assistant config
 */
export class ModelService
  extends BaseService<ModelServiceState>
  implements ServiceWithDependencies
{
  private availableModels: ModelConfig[] = [];
  private assistant: AssistantUnrolled | null = null;
  private authConfig: AuthConfig | null = null;

  constructor() {
    super("ModelService", {
      llmApi: null,
      model: null,
      assistant: null,
      authConfig: null,
    });
  }

  /**
   * Declare dependencies on other services
   */
  getDependencies(): string[] {
    return ["auth", "config", "agentFile"];
  }

  /**
   * Initialize the model service
   */
  async doInitialize(
    assistant: AssistantUnrolled,
    authConfig: AuthConfig,
    agentFileServiceState: AgentFileServiceState | undefined,
  ): Promise<ModelServiceState> {
    logger.debug("ModelService.doInitialize called", {
      hasAssistant: !!assistant,
      hasAuthConfig: !!authConfig,
      assistantModelsCount: assistant?.models?.length || 0,
    });

    // Expand AUTODETECT models if present
    const expandedAssistant = await this.expandAssistantModels(
      assistant,
      authConfig,
    );

    this.assistant = expandedAssistant;
    this.authConfig = authConfig;
    this.availableModels = (expandedAssistant.models?.filter(
      (model) =>
        model && (model.roles?.includes("chat") || model.roles === undefined),
    ) || []) as ModelConfig[];

    let preferredModelName: string | null | undefined = null;
    let modelSource = "default";

    // Priority = agentFile -> last selected model
    if (agentFileServiceState?.agentFileModel?.name) {
      preferredModelName = agentFileServiceState.agentFileModel?.name;
      modelSource = "agentFile";
    } else {
      const persistedName = getModelName(authConfig);
      if (persistedName) {
        preferredModelName = persistedName;
        modelSource = "persisted";
      }
    }

    // Try to use the preferred model (agent file or persisted)
    if (preferredModelName) {
      // During initialization, we need to check against availableModels directly
      const modelIndex = this.availableModels.findIndex((model) => {
        const name = (model as any).name || (model as any).model;
        return name === preferredModelName;
      });
      if (modelIndex === -1) {
        // Preferred model not found, use default model selection
        const [llmApi, model] = getLlmApi(expandedAssistant, authConfig);
        return {
          llmApi,
          model,
          assistant: expandedAssistant,
          authConfig,
        };
      } else {
        // Use the preferred model - but we need to handle initialization specially
        // During init, currentState isn't set yet, so switchModel would fail
        // Instead, we'll manually switch here
        const selectedModel = this.availableModels[modelIndex];
        logger.debug(`Using ${modelSource} model during initialization`, {
          modelIndex,
          provider: selectedModel.provider,
          name: (selectedModel as any).name || "unnamed",
          modelSource,
        });

        const llmApi = createLlmApi(selectedModel, authConfig);
        if (!llmApi) {
          throw new Error(`Failed to initialize LLM with ${modelSource} model`);
        }

        return {
          llmApi,
          model: selectedModel,
          assistant: expandedAssistant,
          authConfig,
        };
      }
    } else {
      // Use default model selection
      const [llmApi, model] = getLlmApi(expandedAssistant, authConfig);
      return {
        llmApi,
        model,
        assistant: expandedAssistant,
        authConfig,
      };
    }
  }

  /**
   * Expands models with model: "AUTODETECT" into all available models from the provider
   */
  private async expandAssistantModels(
    assistant: AssistantUnrolled,
    authConfig: AuthConfig,
  ): Promise<AssistantUnrolled> {
    if (!assistant.models) {
      return assistant;
    }

    const expandedModels: ModelConfig[] = [];
    let modelsChanged = false;
    for (const model of assistant.models) {
      let autodetectSuccess = false;
      if (model && model.model === "AUTODETECT") {
        try {
          logger.debug(
            `Autodetecting models for provider: ${model.provider}...`,
          );
          const llmApi = createLlmApi(model, authConfig);
          if (llmApi) {
            const detected = await llmApi.list();
            logger.debug(
              `Autodetected ${detected.length} models for provider ${model.provider}`,
            );

            if (detected.length > 0) {
              autodetectSuccess = true;
              modelsChanged = true;

              for (const m of detected) {
                // Use core-style naming: "Title (Model Name)" or just "Model Name"
                const modelName = m.id;
                const displayName =
                  (model as any).name && (model as any).name !== "AUTODETECT"
                    ? `${(model as any).name} (${modelName})`
                    : modelName;

                const expandedModel: ModelConfig = {
                  ...model,
                  model: modelName,
                  name: displayName,
                  title: displayName,
                  // Default roles if none specified or empty
                  roles:
                    model.roles && model.roles.length > 0
                      ? model.roles
                      : ["chat", "summarize", "apply"],
                  isFromAutoDetect: true,
                };

                expandedModels.push(expandedModel);

                // Sync discovered model back to proxy so it shows up in other IDEs/clients
                if (authConfig?.accessToken) {
                  void syncModelToProxy("add", {
                    providerSlug: model.provider,
                    modelSlug: modelName,
                    displayName: displayName,
                    apiKey: model.apiKey,
                    apiBase: model.apiBase,
                  }).catch((e) => {
                    logger.debug(
                      `Failed to sync autodetected model ${modelName}:`,
                      e,
                    );
                  });
                }
              }
            }
          } else {
            logger.warn(
              `Could not create LLM API for provider ${model.provider} during autodetection`,
            );
          }
        } catch (e) {
          logger.warn(
            `Failed to autodetect models for provider ${model.provider}:`,
            e,
          );
        }
      }

      if (!autodetectSuccess) {
        expandedModels.push(model);
      }
    }

    if (modelsChanged) {
      return {
        ...assistant,
        models: expandedModels,
      };
    }

    return assistant;
  }

  /**
   * Override isReady to check for required state
   */
  override isReady(): boolean {
    return (
      super.isReady() &&
      this.currentState.llmApi !== null &&
      this.currentState.model !== null
    );
  }

  /**
   * Get model information for display
   */
  getModelInfo(): { provider: string; name: string } | null {
    if (!this.currentState.model) {
      return null;
    }

    return {
      provider: this.currentState.model.provider,
      name: (this.currentState.model as any).name || "unnamed",
    };
  }

  /**
   * Get list of available chat models
   */
  getAvailableChatModels(): Array<{
    provider: string;
    name: string;
    index: number;
  }> {
    // Get assistant from state to ensure we have the latest data
    const { assistant } = this.getState();
    if (!assistant || !assistant.models) {
      return [];
    }

    // Filter for chat models
    const chatModels = (assistant.models.filter(
      (model) =>
        model &&
        (model.roles === undefined ||
          model.roles.length === 0 ||
          model.roles.includes("chat")),
    ) || []) as ModelConfig[];

    return chatModels.map((model, index) => ({
      provider: model.provider,
      name: (model as any).name || (model as any).model || "unnamed",
      index,
    }));
  }

  /**
   * Switch to a different chat model by index
   */
  async switchModel(modelIndex: number): Promise<ModelServiceState> {
    // Get assistant and authConfig from state, but fall back to instance properties
    // This is needed during initialization when state isn't set yet
    const stateValues = this.getState();
    const assistant = stateValues.assistant || this.assistant;
    const authConfig = stateValues.authConfig || this.authConfig;

    // Debug logging to understand the state
    logger.debug("switchModel: Checking state", {
      hasStateAssistant: !!stateValues.assistant,
      hasStateAuthConfig: !!stateValues.authConfig,
      hasInstanceAssistant: !!this.assistant,
      hasInstanceAuthConfig: !!this.authConfig,
      isInitialized: this.isReady(),
      isReady: this.isReady(),
      modelIndex,
    });

    if (!assistant) {
      logger.error("switchModel: Missing assistant data", {
        assistant: !!assistant,
        authConfig: !!authConfig,
        stateKeys: Object.keys(stateValues),
        currentState: {
          hasLlmApi: !!stateValues.llmApi,
          hasModel: !!stateValues.model,
          hasAssistant: !!stateValues.assistant,
          hasAuthConfig: !!stateValues.authConfig,
        },
      });
      throw new Error("ModelService not initialized - assistant data missing");
    }

    // Get available models from assistant in state
    const availableModels = (assistant.models?.filter(
      (model) =>
        model && (model.roles?.includes("chat") || model.roles === undefined),
    ) || []) as ModelConfig[];

    if (modelIndex < 0 || modelIndex >= availableModels.length) {
      throw new Error(
        `Invalid model index: ${modelIndex}. Available models: 0-${availableModels.length - 1}`,
      );
    }

    const selectedModel = availableModels[modelIndex];
    logger.debug("Switching to model", {
      modelIndex,
      provider: selectedModel.provider,
      name: (selectedModel as any).name || "unnamed",
    });

    try {
      const llmApi = createLlmApi(selectedModel, authConfig);

      if (!llmApi) {
        throw new Error("Failed to initialize LLM with selected model");
      }

      this.setState({
        llmApi,
        model: selectedModel,
        assistant,
        authConfig,
      });

      logger.debug("Model switched successfully", {
        modelProvider: selectedModel.provider,
        modelName: (selectedModel as any).name || "unnamed",
      });

      return this.getState();
    } catch (error: any) {
      logger.error("Failed to switch model:", error);
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Get current model index
   */
  getCurrentModelIndex(): number {
    const state = this.getState();
    if (!state.model || !state.assistant) {
      return -1;
    }

    // Get available models from state
    const availableModels = (state.assistant.models?.filter(
      (model) =>
        model && (model.roles?.includes("chat") || model.roles === undefined),
    ) || []) as ModelConfig[];

    return availableModels.findIndex(
      (model) =>
        model.provider === state.model?.provider &&
        (model as any).name === (state.model as any).name,
    );
  }

  /**
   * Get model index by name and provider
   */
  getModelIndexByName(modelName: string, provider?: string): number {
    const state = this.getState();
    if (!state.assistant) {
      return -1;
    }

    // Get available models from state
    const availableModels = (state.assistant.models?.filter(
      (model) =>
        model && (model.roles?.includes("chat") || model.roles === undefined),
    ) || []) as ModelConfig[];

    return availableModels.findIndex((model) => {
      const name = (model as any).name || (model as any).model;
      const nameMatches = name === modelName;

      if (provider) {
        return nameMatches && model.provider === provider;
      }

      return nameMatches;
    });
  }

  static getSubagentModels(modelState: ModelServiceState) {
    if (!modelState.assistant) {
      return [];
    }
    const subagentModels = modelState.assistant.models
      ?.filter((model) => !!model)
      .filter((model) => !!model.name) // filter out models without a name
      .filter((model) => model.roles?.includes("subagent")) // filter with role subagent
      .filter((model) => !!model.chatOptions?.baseSystemMessage); // filter those with a system message

    if (!subagentModels) {
      return [];
    }
    return subagentModels?.map((model) => ({
      llmApi: createLlmApi(model, modelState.authConfig),
      model,
      assistant: modelState.assistant,
      authConfig: modelState.authConfig,
    }));
  }
}
