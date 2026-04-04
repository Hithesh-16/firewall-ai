import { ContextProviderName } from "..";
import { BRAND } from "@ai-firewall/brand";

export const DEFAULT_PROMPTS_FOLDER_V1 = ".prompts";
export const DEFAULT_PROMPTS_FOLDER_V2 = `${BRAND.globalDir}/prompts`;
export const DEFAULT_RULES_FOLDER = `${BRAND.globalDir}/${BRAND.rulesDir}`;

// Subdirectory names (without globalDir prefix)
export const RULES_DIR_NAME = BRAND.rulesDir;
export const PROMPTS_DIR_NAME = "prompts";

export const SUPPORTED_PROMPT_CONTEXT_PROVIDERS: ContextProviderName[] = [
  "file",
  "clipboard",
  "repo-map",
  "currentFile",
  "os",
  "problems",
  "codebase",
  "tree",
  "open",
  "debugger",
  "terminal",
  "diff",
];
