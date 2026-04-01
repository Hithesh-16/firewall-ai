import { BaseContextProvider } from "../";
import {
  ContextItem,
  ContextProviderDescription,
  ContextProviderExtras,
} from "../../";
import { loadAllMemories } from "../../tools/implementations/memory";

class MemoryContextProvider extends BaseContextProvider {
  static description: ContextProviderDescription = {
    title: "memory",
    displayTitle: "Memories",
    description: "Persistent project memories from .ai-firewall/memory/",
    type: "normal",
  };

  async getContextItems(
    _query: string,
    extras: ContextProviderExtras,
  ): Promise<ContextItem[]> {
    const workspaceDirs = await extras.ide.getWorkspaceDirs();
    if (workspaceDirs.length === 0) {
      return [];
    }

    const memories = loadAllMemories(workspaceDirs[0]);
    if (!memories) {
      return [];
    }

    return [
      {
        name: "Project Memories",
        description: "Persistent context from .ai-firewall/memory/",
        content: memories,
      },
    ];
  }
}

export default MemoryContextProvider;
