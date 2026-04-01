export enum ModelProviderTags {
  RequiresApiKey = "Requires API Key",
  Local = "Local",
  Free = "Free",
  OpenSource = "Open-Source",
}

export const MODEL_PROVIDER_TAG_COLORS = {
  [ModelProviderTags.RequiresApiKey]: "var(--vscode-editorError-foreground, #f44336)",
  [ModelProviderTags.Local]: "var(--vscode-testing-iconPassed, #4caf50)",
  [ModelProviderTags.OpenSource]: "var(--vscode-textLink-foreground, #06b6d4)",
  [ModelProviderTags.Free]: "var(--vscode-editorWarning-foreground, #ffb74d)",
};
