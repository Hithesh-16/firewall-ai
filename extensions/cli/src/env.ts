import * as os from "os";
import * as path from "path";

import dotenv from "dotenv";
import { BRAND } from "@ai-firewall/brand";

dotenv.config();

export const env = {
  apiBase: process.env[BRAND.envVars.apiBase] ?? BRAND.apiUrl,
  workOsClientId:
    process.env.WORKOS_CLIENT_ID ?? "client_01J0FW6XN8N2XJAECF7NE0Y65J",
  appUrl: process.env.HUB_URL || BRAND.appUrl,
  continueHome:
    process.env[BRAND.envVars.globalDir] ||
    path.join(os.homedir(), BRAND.globalDir),
};
