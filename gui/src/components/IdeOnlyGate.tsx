/**
 * Renders a friendly "not available" page when the `gui/` app is loaded
 * outside an IDE webview (i.e., a plain browser hitting the Vite dev server
 * or the built `index.html` directly).
 *
 * The `gui/` app is the IDE chat experience for VS Code / JetBrains and is
 * intentionally NOT a public web surface. Admin and dashboard usage lives in
 * the separate `web/` Vite app on port 5174, which talks straight to the
 * proxy REST API and is the correct entrypoint for browser users.
 */
export default function IdeOnlyGate() {
  const sameOriginDashboard =
    typeof window !== "undefined" ? `${window.location.origin}/` : "/";
  const devDashboard =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}:5174/`
      : "http://localhost:5174/";

  return (
    <div className="bg-editor flex min-h-screen flex-col items-center justify-center p-8 text-center font-sans">
      <div className="max-w-[480px]">
        {/* Shield icon */}
        <div className="bg-primary/10 mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl">
          <svg
            width="28"
            height="28"
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

        <h1 className="text-foreground mb-2 text-xl font-semibold">
          AI Firewall {"\u2014"} IDE UI
        </h1>
        <p className="text-description mb-4 text-sm leading-relaxed">
          This interface is the chat experience that runs inside{" "}
          <strong className="text-foreground">VS Code</strong> and{" "}
          <strong className="text-foreground">JetBrains</strong> extensions. It
          is not meant to be opened in a regular browser.
        </p>
        <p className="text-description mb-6 text-sm leading-relaxed">
          For the browser dashboard {"\u2014"} security policies, usage, audit
          logs, RBAC, providers, and team admin {"\u2014"} open the{" "}
          <strong className="text-foreground">AI Firewall Web Dashboard</strong>{" "}
          instead.
        </p>

        <div className="flex flex-col items-center gap-3">
          <a
            href={sameOriginDashboard}
            className="bg-primary text-primary-foreground inline-block rounded-lg px-5 py-2.5 text-sm font-semibold no-underline transition-all hover:brightness-110"
          >
            Open Web Dashboard
          </a>
          <a
            href={devDashboard}
            className="text-description hover:text-foreground text-xs underline transition-colors"
          >
            Or use dev server: {devDashboard}
          </a>
        </div>

        <p className="text-description-muted mt-8 text-[11px]">
          To use the chat experience, install the AI Firewall extension in VS
          Code or JetBrains.
        </p>
      </div>
    </div>
  );
}
