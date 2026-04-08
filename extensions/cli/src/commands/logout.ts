import chalk from "chalk";
import {
  loadAuthConfig,
  getAccessToken,
  logout as workosLogout,
} from "../auth/workos.js";

const PROXY_BASE = process.env.AI_FIREWALL_PROXY_URL || "http://localhost:8080";

export async function logout() {
  // Try to revoke the token on the proxy before clearing local state
  const config = loadAuthConfig();
  const token = getAccessToken(config);

  if (token) {
    try {
      await fetch(`${PROXY_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Proxy may be offline — proceed with local cleanup
    }
  }

  workosLogout();
  console.info(chalk.green("Signed out of AI Firewall."));
}
