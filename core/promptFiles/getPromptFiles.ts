import path from "path";
import {
  DEFAULT_PROMPTS_FOLDER_V1,
  DEFAULT_PROMPTS_FOLDER_V2,
  DEFAULT_RULES_FOLDER,
  RULES_DIR_NAME,
} from ".";
import { IDE } from "..";
import { walkDir } from "../indexing/walkDir";
import {
  getAiFirewallGlobalPath,
  readAllGlobalPromptFiles,
} from "../util/paths";
import { readFileWith } from "../util/scanning/ScanningIde";
import { joinPathsToUri } from "../util/uri";

export async function getPromptFilesFromDir(
  ide: IDE,
  dir: string,
): Promise<{ path: string; content: string }[]> {
  try {
    const exists = await ide.fileExists(dir);

    if (!exists) {
      return [];
    }

    const uris = await walkDir(dir, ide, {
      source: "get dir prompt files",
    });
    const promptFilePaths = uris.filter(
      (p) => p.endsWith(".prompt") || p.endsWith(".md"),
    );
    const results = promptFilePaths.map(async (uri) => {
      const content = await readFileWith(ide, uri, "config"); // make a try catch
      return { path: uri, content };
    });
    return Promise.all(results);
  } catch (e) {
    console.error(e);
    return [];
  }
}

export async function getAllPromptFiles(
  ide: IDE,
  overridePromptFolder?: string,
  checkV1DefaultFolder: boolean = false,
): Promise<{ path: string; content: string }[]> {
  const workspaceDirs = await ide.getWorkspaceDirs();
  let promptFiles: { path: string; content: string }[] = [];

  let dirsToCheck = [DEFAULT_PROMPTS_FOLDER_V2, DEFAULT_RULES_FOLDER];
  if (checkV1DefaultFolder) {
    dirsToCheck.push(DEFAULT_PROMPTS_FOLDER_V1);
  }
  if (overridePromptFolder) {
    dirsToCheck = [overridePromptFolder];
  }

  const fullDirs = workspaceDirs
    .map((dir) => dirsToCheck.map((d) => joinPathsToUri(dir, d)))
    .flat();

  promptFiles = (
    await Promise.all(fullDirs.map((dir) => getPromptFilesFromDir(ide, dir)))
  ).flat();

  // Also read from ~/.ai-firewall/prompts and ~/.ai-firewall/rules
  promptFiles.push(...readAllGlobalPromptFiles());

  const promptFilesFromRulesDirectory = readAllGlobalPromptFiles(
    path.join(getAiFirewallGlobalPath(), RULES_DIR_NAME),
  );
  promptFiles.push(...promptFilesFromRulesDirectory);

  const result = await Promise.all(
    promptFiles.map(async (file) => {
      const content = await readFileWith(ide, file.path, "config");
      return { path: file.path, content };
    }),
  );
  return result;
}
