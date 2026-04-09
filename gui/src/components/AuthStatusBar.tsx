import { useContext, useEffect, useState } from "react";
import { IdeMessengerContext } from "../context/IdeMessenger";

/**
 * Small auth status chip that sits at the bottom of the VS Code
 * sidebar panel. Shows the signed-in user's email on hover and
 * provides one-click Sign In / Sign Out actions.
 *
 * Reads auth state from `~/.ai-firewall/auth.json` via the IDE
 * messenger's file-read capability. No localStorage dependency.
 */
interface AuthState {
  signedIn: boolean;
  email?: string;
}

export function AuthStatusBar() {
  const ideMessenger = useContext(IdeMessengerContext);
  const [auth, setAuth] = useState<AuthState>({ signedIn: false });
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const homeDir =
          typeof process !== "undefined"
            ? process.env.HOME || process.env.USERPROFILE || ""
            : "";
        const content = await ideMessenger.request("readFile", {
          filepath: `${homeDir}/.ai-firewall/auth.json`,
        });
        if (content.status === "success" && content.content) {
          const parsed = JSON.parse(content.content as string) as {
            accessToken?: string;
            user?: { email?: string };
          };
          if (parsed.accessToken) {
            setAuth({
              signedIn: true,
              email: parsed.user?.email,
            });
            return;
          }
        }
      } catch {
        // Can't read the file — treat as signed out
      }
      setAuth({ signedIn: false });
    };
    void check();
    const timer = setInterval(check, 30000);
    return () => clearInterval(timer);
  }, [ideMessenger]);

  function signIn() {
    ideMessenger?.post("openUrl", "command:aiFirewall.login");
  }

  function signOut() {
    ideMessenger?.post("openUrl", "command:aiFirewall.logout");
    setAuth({ signedIn: false });
  }

  function openDashboard() {
    ideMessenger?.post("openUrl", "command:aiFirewall.viewDashboard");
  }

  return (
    <div className="border-border flex items-center justify-between border-t px-3 py-1.5 text-[11px]">
      {auth.signedIn ? (
        <div
          className="relative flex items-center gap-2"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          <span className="bg-success inline-block h-1.5 w-1.5 rounded-full" />
          <span className="text-description cursor-default">
            {auth.email
              ? auth.email.length > 20
                ? auth.email.slice(0, 18) + "\u2026"
                : auth.email
              : "Signed in"}
          </span>
          {showTooltip && auth.email && (
            <div className="border-border bg-editor text-foreground absolute bottom-full left-0 z-50 mb-1 whitespace-nowrap rounded border px-2 py-1 text-[11px] shadow-md">
              {auth.email}
            </div>
          )}
          <span
            onClick={signOut}
            className="text-description-muted hover:text-foreground cursor-pointer text-[10px] transition-colors"
            title="Sign out of AI Firewall"
          >
            Sign Out
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="bg-description-muted inline-block h-1.5 w-1.5 rounded-full" />
          <span className="text-description-muted">Not signed in</span>
          <span
            onClick={signIn}
            className="border-border text-description hover:bg-list-hover hover:text-foreground cursor-pointer rounded border px-1.5 py-0.5 text-[10px] transition-colors"
            title="Sign in to AI Firewall"
          >
            Sign In
          </span>
        </div>
      )}

      {/* Dashboard quick-link */}
      <span
        onClick={openDashboard}
        className="text-description-muted hover:text-foreground cursor-pointer transition-colors"
        title="Open Security Dashboard"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          className="text-current"
        >
          <path
            d="M2 2h5v5H2V2zm7 0h5v5H9V2zM2 9h5v5H2V9zm7 1.5a3.5 3.5 0 107 0 3.5 3.5 0 00-7 0z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  );
}
