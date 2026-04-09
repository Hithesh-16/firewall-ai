import { useContext } from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";

/**
 * IDE webview login/logout page. Delegates to the host IDE's
 * native commands via the `command:` URL prefix, which the
 * VsCodeMessenger `openUrl` handler intercepts and routes to
 * `vscode.commands.executeCommand()`.
 */
export default function LoginPage() {
  const ideMessenger = useContext(IdeMessengerContext);

  function signIn() {
    try {
      ideMessenger?.post("openUrl", "command:aiFirewall.login");
    } catch {
      // Fallback: user can open command palette manually
    }
  }

  function signOut() {
    try {
      ideMessenger?.post("openUrl", "command:aiFirewall.logout");
    } catch {
      // Fallback: user can open command palette manually
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-5 p-6 text-center">
      {/* Shield icon */}
      <div className="bg-primary/10 flex h-12 w-12 items-center justify-center rounded-xl">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          className="text-primary"
        >
          <path
            d="M12 2L21 5.5V11C21 16.5 17.2 20.8 12 22.5C6.8 20.8 3 16.5 3 11V5.5L12 2Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M8 12.5L10.8 15.3L16 9.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div>
        <h2 className="text-foreground text-lg font-semibold">
          AI Firewall Account
        </h2>
        <p className="text-description mt-1.5 text-xs leading-relaxed">
          Sign in to sync your models, policies, and settings across the CLI, VS
          Code, JetBrains, and the web dashboard.
        </p>
      </div>

      <div className="flex w-full flex-col gap-2">
        <button
          className="bg-primary text-primary-foreground w-full rounded-md px-4 py-2 text-sm font-medium transition-all hover:brightness-110"
          onClick={signIn}
        >
          Sign In
        </button>
        <button
          className="border-border text-description hover:bg-list-hover hover:text-foreground w-full rounded-md border bg-transparent px-4 py-2 text-sm font-medium transition-all"
          onClick={signOut}
        >
          Sign Out
        </button>
      </div>

      <div className="text-description-muted mt-2 space-y-1 text-[10px]">
        <div>
          Command Palette:{" "}
          <span className="bg-input text-description rounded px-1 py-0.5 font-mono">
            AI Firewall: Sign In
          </span>
        </div>
        <div>
          CLI:{" "}
          <span className="bg-input text-description rounded px-1 py-0.5 font-mono">
            cn login
          </span>
        </div>
      </div>
    </div>
  );
}
