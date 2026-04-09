import { useContext } from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";

/**
 * Phase 8 — the `gui/` package is now the IDE webview only. Standalone
 * browser access is blocked by `IdeOnlyGate` in `App.tsx`, and all
 * sign-in has moved to the host IDE's native command:
 *
 *   - VS Code:   Command Palette → "AI Firewall: Sign In"
 *   - JetBrains: Go to Action → "AI Firewall: Sign In"
 *   - CLI:       `cn login` (or `/login` inside the TUI)
 *
 * The 500+ lines of dashboard-style login UI that used to live here
 * has been replaced with a pointer. Centralising the sign-in surface
 * means a single audit surface for auth, and a single place to make
 * changes — the proxy's `/web-login-start` bridge plus the web/
 * dashboard LoginPage.
 */
export default function LoginPage() {
  const ideMessenger = useContext(IdeMessengerContext);

  function openHostCommand() {
    // Ask the host IDE to run its sign-in command. Both the VS Code
    // extension (`aiFirewall.login`) and the JetBrains plugin
    // (`aiFirewall.signIn` action) handle this the same way: pop
    // open the system browser, wait for the loopback / URI callback,
    // and write the shared auth file.
    try {
      ideMessenger?.post("openUrl", "command:aiFirewall.login");
    } catch {
      // Fallback: do nothing — the instructions below tell the user
      // how to reach it manually.
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="text-2xl font-semibold">Sign in to AI Firewall</div>
      <div className="text-sm opacity-75">
        Sign-in is handled by your IDE. Run the{" "}
        <span className="rounded bg-black/10 px-1 py-0.5 font-mono">
          AI Firewall: Sign In
        </span>{" "}
        command and complete the flow in the browser tab that opens.
      </div>
      <button
        className="rounded bg-emerald-500 px-4 py-2 font-medium text-white hover:bg-emerald-600"
        onClick={openHostCommand}
      >
        Open Sign-In
      </button>
      <div className="mt-4 text-xs opacity-60">
        CLI users: run <span className="font-mono">cn login</span> from your
        terminal.
      </div>
    </div>
  );
}
