import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { useContext, useEffect, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { Button, Input, StyledActionButton } from "../components";
import Alert from "../components/gui/Alert";
import ModelSelectionListbox from "../components/modelSelection/ModelSelectionListbox";
import { useAuth } from "../context/Auth";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { completionParamsInputs } from "../pages/AddNewModel/configs/completionParamsInputs";
import { DisplayInfo } from "../pages/AddNewModel/configs/models";
import {
  initializeOpenRouterModels,
  ProviderInfo,
  providers,
} from "../pages/AddNewModel/configs/providers";
import { useAppDispatch } from "../redux/hooks";
import { updateSelectedModelByRole } from "../redux/thunks/updateSelectedModelByRole";

interface AddModelFormProps {
  onDone: () => void;
  hideFreeTrialLimitMessage?: boolean;
}

const MODEL_PROVIDERS_URL =
  "https://docs.ai-firewall.dev/customize/model-providers";
const CODESTRAL_URL = "https://console.mistral.ai/codestral";
const AI_FIREWALL_SETUP_URL = "https://docs.ai-firewall.dev/setup/overview";

export function AddModelForm({
  onDone,
  hideFreeTrialLimitMessage,
}: AddModelFormProps) {
  const [selectedProvider, setSelectedProvider] = useState<ProviderInfo>(
    providers["openai"]!,
  );
  const dispatch = useAppDispatch();
  const { selectedProfile } = useAuth();
  const [selectedModel, setSelectedModel] = useState(
    selectedProvider.packages[0],
  );
  const formMethods = useForm();
  const ideMessenger = useContext(IdeMessengerContext);

  // Submission-level error state for when the proxy write fails.
  // We used to silently fall back to writing into the local
  // `config.yaml`; that let offline and not-signed-in users create
  // models that the DB never knew about, which then drifted out of
  // sync and eventually got either overwritten by the next sync
  // (models disappear) or left as dead entries with invalid keys
  // (which is what produced the `apiKey: "user-managed: true"` bug
  // in the wild). Post-refactor the DB is the ONLY write path.
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Initialize OpenRouter models from API on component mount
  useEffect(() => {
    void initializeOpenRouterModels();
  }, []);

  const popularProviderTitles = [
    providers["openai"]?.title || "",
    providers["anthropic"]?.title || "",
    providers["mistral"]?.title || "",
    providers["gemini"]?.title || "",
    providers["azure"]?.title || "",
    providers["ollama"]?.title || "",
    providers["openrouter"]?.title || "",
  ];

  const allProviders = Object.entries(providers)
    .filter(([key]) => !["openai-aiohttp"].includes(key))
    .map(([, provider]) => provider)
    .filter((provider) => !!provider)
    .map((provider) => provider!); // for type checking

  const popularProviders = allProviders
    .filter((provider) => popularProviderTitles.includes(provider.title))
    .sort((a, b) => a.title.localeCompare(b.title));

  const otherProviders = allProviders
    .filter((provider) => !popularProviderTitles.includes(provider.title))
    .sort((a, b) => a.title.localeCompare(b.title));

  const selectedProviderApiKeyUrl =
    selectedModel && selectedModel.params.model.startsWith("codestral")
      ? CODESTRAL_URL
      : selectedProvider.apiKeyUrl;

  function isDisabled() {
    if (selectedProvider.downloadUrl) {
      return false;
    }

    const required = selectedProvider.collectInputFor
      ?.filter((input) => input.required)
      .map((input) => {
        const value = formMethods.watch(input.key);
        return value;
      });

    return !required?.every((value) => value !== undefined && value.length > 0);
  }

  useEffect(() => {
    setSelectedModel(selectedProvider.packages[0]);
  }, [selectedProvider]);

  async function onSubmit() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const apiKey = (formMethods.watch("apiKey") ?? "").trim();
      const modelSlug = selectedModel.params?.model ?? selectedModel.title;
      const displayName = selectedModel.title;
      const needsKey = !!selectedProvider.apiKeyUrl;

      // ── Validation ──────────────────────────────────────────
      // Reject the opt-out marker as a key value. This was a real
      // user-error footgun: people read our config.yaml header
      // ("# user-managed: true on the first line opts out…"), copied
      // the literal string into the key field, and saved it. Every
      // subsequent LLM call then hit auth failures that surfaced as
      // "Unexpected non-whitespace character after JSON".
      if (needsKey && apiKey === "") {
        setSubmitError("Enter the API key for this provider.");
        return;
      }
      if (/user-managed/i.test(apiKey)) {
        setSubmitError(
          "That isn't an API key — `user-managed: true` is a marker " +
            "used in config.yaml headers. Paste the actual key from the provider.",
        );
        return;
      }
      if (!modelSlug) {
        setSubmitError("Pick a model before saving.");
        return;
      }

      // ── The ONLY write path: proxy → user_models DB. ────────
      //
      // We used to fall back to Continue's native `config/addModel`
      // here when the proxy call failed. That was wrong — it let
      // offline users create models the DB never saw, which then
      // drifted (next sync wiped them) or silently carried bogus
      // keys. Post-refactor the contract is: DB is the single source
      // of truth, and "couldn't reach the DB" means "couldn't save".
      let proxyRes: Awaited<ReturnType<typeof ideMessenger.request>>;
      try {
        proxyRes = await ideMessenger.request("aiFirewall/addUserModel", {
          providerSlug: selectedProvider.provider ?? "",
          modelSlug,
          displayName,
          apiKey,
          apiBase: selectedProvider.params?.apiBase,
          roles: ["chat"],
        });
      } catch (err) {
        setSubmitError(
          `Couldn't reach the AI Firewall proxy to save this model (${
            err instanceof Error ? err.message : String(err)
          }). Sign in / start the proxy and try again.`,
        );
        return;
      }

      if (proxyRes.status !== "success") {
        // Some error message types don't carry a `content` field —
        // cast through `any` to read the optional error bag the
        // extension host attaches on failure.
        const reason =
          (proxyRes as unknown as { error?: string }).error ??
          "Unknown error — check that you are signed in.";
        setSubmitError(
          `Model not saved: ${reason}\n\nModels are stored in your AI Firewall account, not in a local file. If you can't sign in, add the model from the web dashboard under Settings → Models.`,
        );
        return;
      }
      const content = (
        proxyRes as { content?: { ok?: boolean; error?: string } }
      ).content;
      if (!content?.ok) {
        setSubmitError(
          `Model not saved: ${content?.error ?? "Unknown error"}\n\nModels are stored in your AI Firewall account, not in a local file. If you can't sign in, add the model from the web dashboard under Settings → Models.`,
        );
        return;
      }

      // DB write succeeded — switch the currently-selected model to
      // the one we just created. The config-handler reloads on the
      // auth-change + the next scheduled sync will pull the fresh
      // YAML into ~/.ai-firewall/config.yaml.
      void dispatch(
        updateSelectedModelByRole({
          selectedProfile,
          role: "chat",
          modelTitle: selectedModel.title,
        }),
      );
      onDone();
    } finally {
      setSubmitting(false);
    }
  }

  function onClickDownloadProvider() {
    selectedProvider.downloadUrl &&
      ideMessenger.post("openUrl", selectedProvider.downloadUrl);
  }

  return (
    <FormProvider {...formMethods}>
      <form onSubmit={formMethods.handleSubmit(onSubmit)}>
        <div className="mx-auto max-w-md p-6">
          <h1 className="mb-0 text-center text-2xl">Add Chat model</h1>

          <div className="my-8 flex flex-col gap-6">
            <div>
              <label className="block text-sm font-medium">Provider</label>
              <ModelSelectionListbox
                selectedProvider={selectedProvider}
                setSelectedProvider={(val: DisplayInfo) => {
                  const match = [...popularProviders, ...otherProviders].find(
                    (provider) => provider.title === val.title,
                  );
                  if (match) {
                    setSelectedProvider(match);
                  }
                }}
                topOptions={popularProviders}
                otherOptions={otherProviders}
                searchPlaceholder="Search providers..."
              />
              <span className="text-description-muted mt-1 block text-xs">
                Don't see your provider?{" "}
                <a
                  className="cursor-pointer text-inherit underline hover:text-inherit"
                  onClick={() =>
                    ideMessenger.post("openUrl", MODEL_PROVIDERS_URL)
                  }
                >
                  Click here
                </a>{" "}
                to view the full list
              </span>
            </div>

            {selectedProvider.downloadUrl && (
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Install provider
                </label>
                <StyledActionButton onClick={onClickDownloadProvider}>
                  <p className="text-sm underline">
                    {selectedProvider.downloadUrl}
                  </p>
                  <ArrowTopRightOnSquareIcon width={24} height={24} />
                </StyledActionButton>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium">Model</label>
              <ModelSelectionListbox
                selectedProvider={selectedModel}
                setSelectedProvider={(val: DisplayInfo) => {
                  const options =
                    Object.entries(providers).find(
                      ([, provider]) =>
                        provider?.title === selectedProvider.title,
                    )?.[1]?.packages ?? [];
                  const match = options.find(
                    (option) => option.title === val.title,
                  );
                  if (match) {
                    setSelectedModel(match);
                  }
                }}
                topOptions={
                  Object.entries(providers).find(
                    ([, provider]) =>
                      provider?.title === selectedProvider.title,
                  )?.[1]?.packages
                }
              />
            </div>

            {selectedModel.params.model.startsWith("codestral") && (
              <div className="my-2">
                <Alert>
                  <p className="m-0 text-sm font-bold">Codestral API key</p>
                  <p className="m-0 mt-1">
                    Note that codestral requires a different API key from other
                    Mistral models
                  </p>
                </Alert>
              </div>
            )}

            {selectedProvider.apiKeyUrl && (
              <div>
                <>
                  <label className="mb-1 block text-sm font-medium">
                    API key
                  </label>
                  <Input
                    id="apiKey"
                    className="w-full"
                    type="password"
                    placeholder={`Enter your ${selectedProvider.title} API key`}
                    {...formMethods.register("apiKey")}
                  />
                  <span className="text-description-muted mt-1 block text-xs">
                    <a
                      className="cursor-pointer text-inherit underline hover:text-inherit hover:brightness-125"
                      onClick={() => {
                        if (selectedProviderApiKeyUrl) {
                          ideMessenger.post(
                            "openUrl",
                            selectedProviderApiKeyUrl,
                          );
                        }
                      }}
                    >
                      Click here
                    </a>{" "}
                    to create a {selectedProvider.title} API key
                  </span>
                </>
              </div>
            )}

            {selectedProvider.collectInputFor &&
              selectedProvider.collectInputFor
                .filter(
                  (field) =>
                    !Object.values(completionParamsInputs).some(
                      (input) => input.key === field.key,
                    ) &&
                    field.required &&
                    field.key !== "apiKey",
                )
                .map((field) => (
                  <div key={field.key}>
                    <>
                      <label className="mb-1 block text-sm font-medium">
                        {field.label}
                      </label>
                      <Input
                        id={field.key}
                        className="w-full"
                        defaultValue={field.defaultValue}
                        placeholder={`${field.placeholder}`}
                        {...formMethods.register(field.key)}
                      />
                    </>
                  </div>
                ))}
          </div>

          <div className="mt-4 w-full">
            {submitError && (
              <div
                role="alert"
                className="text-error border-error/30 bg-error/10 mb-2 whitespace-pre-line rounded-md border px-3 py-2 text-xs"
              >
                {submitError}
              </div>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={isDisabled() || submitting}
            >
              {submitting ? "Saving…" : "Connect"}
            </Button>

            <span className="text-description-muted block w-full text-center text-xs">
              This will update your{" "}
              <span
                className="cursor-pointer underline hover:brightness-125"
                onClick={() =>
                  ideMessenger.post("config/openProfile", {
                    profileId: undefined,
                  })
                }
              >
                config file
              </span>
            </span>
          </div>
        </div>
      </form>
    </FormProvider>
  );
}

export default AddModelForm;
