import { useContext, useEffect, useRef, useState } from "react";
import { IdeMessengerContext } from "../context/IdeMessenger";

/**
 * Auth status bar + profile menu for the VS Code sidebar panel.
 *
 * Shows a profile icon with the user's initial (or a generic icon
 * when signed out). Clicking opens a dropdown with:
 *   - Signed-in: email, role badge, Sign Out button, Dashboard link
 *   - Signed-out: Sign In button, description
 *
 * Reads auth state from `~/.ai-firewall/auth.json` via the IDE
 * messenger's file-read capability. Polls every 30s so a background
 * login/logout is reflected without a manual refresh.
 */

interface AuthState {
  signedIn: boolean;
  email?: string;
  name?: string;
  role?: string;
  userId?: number;
}

export function AuthStatusBar() {
  const ideMessenger = useContext(IdeMessengerContext);
  const [auth, setAuth] = useState<AuthState>({ signedIn: false });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Auth state polling ──────────────────────────────────────

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
            user?: {
              email?: string;
              name?: string;
              role?: string;
              id?: number;
            };
          };
          if (parsed.accessToken) {
            setAuth({
              signedIn: true,
              email: parsed.user?.email,
              name: parsed.user?.name,
              role: parsed.user?.role,
              userId: parsed.user?.id,
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

  // ── Click-outside to close ──────────────────────────────────

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  // ── Actions ─────────────────────────────────────────────────

  function signIn() {
    ideMessenger?.post("openUrl", "command:aiFirewall.login");
    setMenuOpen(false);
  }

  function signOut() {
    ideMessenger?.post("openUrl", "command:aiFirewall.logout");
    setAuth({ signedIn: false });
    setMenuOpen(false);
  }

  function openDashboard() {
    ideMessenger?.post("openUrl", "command:aiFirewall.viewDashboard");
    setMenuOpen(false);
  }

  // ── Helpers ─────────────────────────────────────────────────

  const initial = auth.name
    ? auth.name[0].toUpperCase()
    : auth.email
      ? auth.email[0].toUpperCase()
      : "?";

  const displayName = auth.name ?? auth.email ?? "Unknown";
  const truncatedEmail =
    auth.email && auth.email.length > 28
      ? auth.email.slice(0, 26) + "\u2026"
      : auth.email;

  // ── Render ──────────────────────────────────────────────────

  return (
    <div
      ref={menuRef}
      className="border-border relative flex items-center justify-between border-t px-3 py-1.5 text-[11px]"
    >
      {/* Left: profile chip */}
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="hover:bg-list-hover flex items-center gap-2 rounded px-1 py-0.5 transition-colors"
        title={
          auth.signedIn
            ? `Signed in as ${auth.email ?? "user"}`
            : "Click to sign in"
        }
      >
        {/* Avatar circle */}
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
            auth.signedIn
              ? "bg-primary/20 text-primary"
              : "bg-description-muted/20 text-description-muted"
          }`}
        >
          {auth.signedIn ? (
            initial
          ) : (
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 8a3 3 0 100-6 3 3 0 000 6zm-5 8a5 5 0 0110 0H3z" />
            </svg>
          )}
        </span>

        {/* Status text */}
        <span
          className={
            auth.signedIn ? "text-foreground" : "text-description-muted"
          }
        >
          {auth.signedIn ? (truncatedEmail ?? "Signed in") : "Not signed in"}
        </span>

        {/* Online indicator */}
        {auth.signedIn && (
          <span className="bg-success inline-block h-1.5 w-1.5 rounded-full" />
        )}
      </button>

      {/* Right: dashboard icon */}
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

      {/* ── Dropdown menu ──────────────────────────────────── */}
      {menuOpen && (
        <div className="border-border bg-editor absolute bottom-full left-2 z-50 mb-1 w-56 rounded-lg border shadow-lg">
          {auth.signedIn ? (
            <div className="flex flex-col">
              {/* User info header */}
              <div className="border-border flex items-center gap-2.5 border-b px-3 py-2.5">
                <span className="bg-primary/20 text-primary flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold">
                  {initial}
                </span>
                <div className="flex flex-col overflow-hidden">
                  <span className="text-foreground truncate text-xs font-medium">
                    {displayName}
                  </span>
                  {auth.email && auth.email !== displayName && (
                    <span className="text-description truncate text-[10px]">
                      {auth.email}
                    </span>
                  )}
                  {auth.role && (
                    <span className="bg-badge text-badge-foreground mt-0.5 w-fit rounded px-1 py-px text-[9px] font-medium uppercase">
                      {auth.role}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col py-1">
                <button
                  type="button"
                  onClick={openDashboard}
                  className="text-description hover:bg-list-hover hover:text-foreground flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors"
                >
                  <svg
                    width="12"
                    height="12"
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
                  Security Dashboard
                </button>
                <button
                  type="button"
                  onClick={signOut}
                  className="text-description hover:bg-list-hover hover:text-foreground flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="none"
                    className="text-current"
                  >
                    <path
                      d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3m4-9l4 4m0 0l-4 4m4-4H6"
                      stroke="currentColor"
                      strokeWidth="1.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Sign Out
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col">
              {/* Signed-out state */}
              <div className="border-border flex flex-col gap-1.5 border-b px-3 py-3">
                <span className="text-foreground text-xs font-medium">
                  AI Firewall
                </span>
                <span className="text-description text-[10px] leading-relaxed">
                  Sign in to sync your providers, policies, and scan history
                  across VS Code, the web dashboard, and CLI.
                </span>
              </div>

              <div className="py-1">
                <button
                  type="button"
                  onClick={signIn}
                  className="bg-primary text-primary-foreground hover:bg-primary-hover mx-2 my-1 w-[calc(100%-16px)] rounded px-3 py-1.5 text-center text-xs font-medium transition-colors"
                >
                  Sign In
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
