import { BaseContextProvider } from "../";
import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
  ContextSubmenuItem,
  LoadSubmenuItemsArgs,
} from "../../";
import { isSecurityConcern } from "../../indexing/ignore";
import { walkDirs } from "../../indexing/walkDir";
import { scanFileForContext } from "../../util/scanFileForContext";
import {
  getShortestUniqueRelativeUriPaths,
  getUriDescription,
  getUriPathBasename,
} from "../../util/uri";

const MAX_SUBMENU_ITEMS = 10_000;

class FileContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "file",
    displayTitle: "Files",
    description: "Type to search",
    type: "submenu",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    // Assume the query is a filepath
    const fileUri = query.trim();

    if (isSecurityConcern(fileUri)) {
      return [
        {
          name: getUriPathBasename(fileUri),
          description: "Restricted file",
          content:
            "This file is restricted by security policy and cannot be included in AI context.",
          uri: { type: "file", value: fileUri },
        },
      ];
    }

    const rawContent = await extras.ide.readFile(fileUri);

    const { relativePathOrBasename, last2Parts, baseName } = getUriDescription(
      fileUri,
      await extras.ide.getWorkspaceDirs(),
    );

    const scan = await scanFileForContext(
      fileUri,
      rawContent,
      extras.fetch as typeof fetch,
    );

    const items: ContextItem[] = [
      {
        name: baseName,
        description: last2Parts,
        content: `\`\`\`${relativePathOrBasename}\n${scan.content}\n\`\`\``,
        uri: {
          type: "file",
          value: fileUri,
        },
      },
    ];
    if (scan.reportItem) items.push(scan.reportItem);
    return items;
  }

  async loadSubmenuItems(
    args: LoadSubmenuItemsArgs,
  ): Promise<ContextSubmenuItem[]> {
    const workspaceDirs = await args.ide.getWorkspaceDirs();
    const results = await walkDirs(
      args.ide,
      {
        source: "load submenu items - file",
      },
      workspaceDirs,
    );
    const files = results.flat().slice(-MAX_SUBMENU_ITEMS);
    const withUniquePaths = getShortestUniqueRelativeUriPaths(
      files,
      workspaceDirs,
    );

    return withUniquePaths.map((file) => {
      return {
        id: file.uri,
        title: getUriPathBasename(file.uri),
        description: file.uniquePath,
      };
    });
  }
}

export default FileContextProvider;
