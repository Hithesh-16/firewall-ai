import { BaseContextProvider } from "../";
import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
} from "../../";
import { scanFileForContext } from "../../util/scanFileForContext";
import { getUriDescription } from "../../util/uri";

class CurrentFileContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "currentFile",
    displayTitle: "Current File",
    description: "Reference the currently open file",
    type: "normal",
    renderInlineAs: "",
  };

  async getContextItems(
    query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    const currentFile = await extras.ide.getCurrentFile();
    if (!currentFile) {
      return [];
    }

    const { relativePathOrBasename, last2Parts, baseName } = getUriDescription(
      currentFile.path,
      await extras.ide.getWorkspaceDirs(),
    );

    let prefix = "This is the currently open file:";
    let name = baseName;

    // This allows frontend to retrieve when using alt + enter or default context with slightly different copy
    if (query === "non-mention-usage") {
      prefix =
        "The following file is currently open. Don't reference it if it's not relevant to the user's message:";
      name = "Active file: " + baseName;
    }

    // Route through the AI Firewall scan so REDACT and BLOCK decisions
    // are honored when files are pulled in via the @currentFile mention,
    // not just via the readFile tool. The scan also produces an inline
    // report ContextItem (file:line:col + masked values) that the chat
    // renders next to the file content.
    const scan = await scanFileForContext(
      currentFile.path,
      currentFile.contents,
      extras.fetch as typeof fetch,
    );

    const items: ContextItem[] = [
      {
        description: last2Parts,
        content: `${prefix}\n\n\`\`\`${relativePathOrBasename}\n${scan.content}\n\`\`\``,
        name,
        uri: {
          type: "file",
          value: currentFile.path,
        },
      },
    ];
    if (scan.reportItem) items.push(scan.reportItem);
    return items;
  }
}

export default CurrentFileContextProvider;
