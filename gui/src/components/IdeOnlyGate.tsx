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
  // The web/ dashboard runs on a different port during dev, but in production
  // it's typically served from the same host root by the proxy. Try same-origin
  // first; fall back to the dev-server port hint.
  const sameOriginDashboard =
    typeof window !== "undefined" ? `${window.location.origin}/` : "/";
  const devDashboard =
    typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}:5174/`
      : "http://localhost:5174/";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: "2rem",
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        backgroundColor: "#0f172a",
        color: "#e2e8f0",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 520 }}>
        <h1 style={{ fontSize: "1.75rem", marginBottom: "0.75rem" }}>
          AI Firewall — IDE UI
        </h1>
        <p
          style={{
            fontSize: "1rem",
            lineHeight: 1.55,
            color: "#94a3b8",
            marginBottom: "1.5rem",
          }}
        >
          This interface is the chat experience that runs inside the
          <strong> VS Code </strong> and <strong>JetBrains</strong> extensions.
          It is not meant to be opened in a regular browser.
        </p>
        <p
          style={{
            fontSize: "0.95rem",
            lineHeight: 1.5,
            color: "#cbd5e1",
            marginBottom: "1.75rem",
          }}
        >
          For the browser dashboard — security policies, usage, audit logs,
          RBAC, providers, and team admin — open the{" "}
          <strong>AI Firewall Web Dashboard</strong> instead.
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            alignItems: "center",
          }}
        >
          <a
            href={sameOriginDashboard}
            style={{
              padding: "0.65rem 1.25rem",
              backgroundColor: "#3b82f6",
              color: "#ffffff",
              borderRadius: "0.5rem",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: "0.95rem",
            }}
          >
            Open Web Dashboard
          </a>
          <a
            href={devDashboard}
            style={{
              fontSize: "0.85rem",
              color: "#60a5fa",
              textDecoration: "underline",
            }}
          >
            Or use dev server: {devDashboard}
          </a>
        </div>
        <p
          style={{
            fontSize: "0.8rem",
            color: "#64748b",
            marginTop: "2rem",
          }}
        >
          To use the chat experience, install the AI Firewall extension in VS
          Code or JetBrains.
        </p>
      </div>
    </div>
  );
}
