import * as os from "os";
import * as path from "path";

import dotenv from "dotenv";

dotenv.config();

export const env = {
  apiBase: process.env.AI_FIREWALL_API_BASE ?? "https://api.ai-firewall.dev/",
  workOsClientId:
    process.env.WORKOS_CLIENT_ID ?? "client_01J0FW6XN8N2XJAECF7NE0Y65J",
  appUrl: process.env.HUB_URL || "https://ai-firewall.dev",
  continueHome:
    process.env.AI_FIREWALL_GLOBAL_DIR || path.join(os.homedir(), ".ai-firewall"),
};
