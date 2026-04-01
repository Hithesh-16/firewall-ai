import { FormEvent, useEffect, useState } from "react";

// Login page uses raw fetch (no token exists yet — pre-auth)
const PROXY_BASE = (window as any).__PROXY_URL ?? "http://localhost:8080";

interface AuthResponse {
  user: { id: number; email: string; name: string; role: string; orgId: number | null };
  token: string;
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      {/* Brand colors — intentionally hardcoded per Google brand guidelines */}
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 010-9.18l-7.98-6.19a24.08 24.08 0 000 21.56l7.98-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 23 23">
      {/* Brand colors — intentionally hardcoded per Microsoft brand guidelines */}
      <rect fill="#f25022" x="1" y="1" width="10" height="10"/>
      <rect fill="#00a4ef" x="1" y="12" width="10" height="10"/>
      <rect fill="#7fba00" x="12" y="1" width="10" height="10"/>
      <rect fill="#ffb900" x="12" y="12" width="10" height="10"/>
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0110 0v4"/>
    </svg>
  );
}

export default function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState<string | null>(null);

  useEffect(() => {
    function handleSSOMessage(event: MessageEvent) {
      if (event.data?.type === "afw-sso-token" && event.data.token) {
        localStorage.setItem("afw_token", event.data.token);
        window.location.reload();
      }
    }
    window.addEventListener("message", handleSSOMessage);
    return () => window.removeEventListener("message", handleSSOMessage);
  }, []);

  const handleSSO = (provider: string) => {
    setSsoLoading(provider);
    setError(null);
    const width = 500;
    const height = 600;
    const left = window.screenX + (window.innerWidth - width) / 2;
    const top = window.screenY + (window.innerHeight - height) / 2;
    window.open(
      `${PROXY_BASE}/api/auth/sso/login?provider=${provider}`,
      "ai-firewall-sso",
      `width=${width},height=${height},left=${left},top=${top}`,
    );
    setTimeout(() => setSsoLoading(null), 5000);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const endpoint = isRegister ? "/api/auth/register" : "/api/auth/login";
    const body = isRegister ? { email, name, password } : { email, password };

    try {
      const res = await fetch(`${PROXY_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }

      const authData = data as AuthResponse;
      localStorage.setItem("afw_token", authData.token);

      // Redirect to onboarding if user has no org, otherwise reload
      if (authData.user.orgId === null) {
        window.postMessage({ type: "navigate", path: "/onboarding" }, "*");
      } else {
        window.location.reload();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Network error";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const ssoButton = (
    provider: string,
    label: string,
    icon: React.ReactNode,
  ) => (
    <button
      key={provider}
      onClick={() => handleSSO(provider)}
      disabled={ssoLoading !== null}
      className="group flex items-center gap-3 w-full rounded-lg px-4 py-3 text-sm font-medium
        bg-input text-foreground border border-border
        hover:bg-list-hover hover:border-border-focus
        active:scale-[0.98]
        transition-all duration-150
        disabled:opacity-40 disabled:pointer-events-none"
    >
      <span className="flex-shrink-0 opacity-90 group-hover:opacity-100 transition-opacity">
        {icon}
      </span>
      <span className="flex-1 text-left">
        {ssoLoading === provider ? "Connecting..." : label}
      </span>
      {ssoLoading === provider && <LoadingSpinner />}
    </button>
  );

  return (
    <div className="flex items-center justify-center min-h-screen bg-editor">
      <div className="w-full max-w-[400px] mx-auto px-6">

        {/* Logo + branding */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-primary text-primary-foreground mx-auto mb-5 shadow-lg">
            <ShieldIcon />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">
            AI Firewall
          </h1>
          <p className="text-sm text-description mt-2">
            {isRegister
              ? "Create your account to get started"
              : "Secure AI code agent"}
          </p>
        </div>

        {/* Card container */}
        <div className="rounded-2xl border border-border bg-secondary p-6 shadow-sm">

          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-xs mb-5 border border-error/20 bg-error/5 text-error">
              <svg
                className="w-4 h-4 mt-0.5 flex-shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="leading-relaxed">{error}</span>
            </div>
          )}

          {/* SSO Buttons */}
          <div className="flex flex-col gap-2.5">
            {ssoButton("google", "Continue with Google", <GoogleIcon />)}
            {ssoButton("github", "Continue with GitHub", <GitHubIcon />)}
            {ssoButton("microsoft", "Continue with Microsoft", <MicrosoftIcon />)}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-border" />
            <span className="text-2xs text-description-muted uppercase tracking-[0.15em] font-medium">
              or
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Email/Password Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {isRegister && (
              <div>
                <label className="block text-2xs font-medium text-description mb-1.5">
                  Full name
                </label>
                <input
                  className="w-full bg-input text-input-foreground border border-input-border rounded-lg px-3.5 py-2.5 text-sm
                    placeholder:text-input-placeholder
                    focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus
                    transition-all duration-150"
                  placeholder="Jane Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>
            )}
            <div>
              <label className="block text-2xs font-medium text-description mb-1.5">
                Email
              </label>
              <input
                className="w-full bg-input text-input-foreground border border-input-border rounded-lg px-3.5 py-2.5 text-sm
                  placeholder:text-input-placeholder
                  focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus
                  transition-all duration-150"
                placeholder="you@company.com"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="block text-2xs font-medium text-description mb-1.5">
                Password
              </label>
              <input
                className="w-full bg-input text-input-foreground border border-input-border rounded-lg px-3.5 py-2.5 text-sm
                  placeholder:text-input-placeholder
                  focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus
                  transition-all duration-150"
                placeholder={isRegister ? "Min 8 characters" : "Enter password"}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={isRegister ? 8 : undefined}
                autoComplete={isRegister ? "new-password" : "current-password"}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex items-center justify-center gap-2 w-full rounded-lg px-3 py-3 text-sm font-semibold mt-1
                bg-primary text-primary-foreground
                hover:bg-primary-hover
                active:scale-[0.98]
                transition-all duration-150
                disabled:opacity-50 disabled:pointer-events-none
                shadow-sm"
            >
              {loading && <LoadingSpinner />}
              {loading
                ? "Please wait..."
                : isRegister
                  ? "Create Account"
                  : "Sign In"}
            </button>
          </form>
        </div>

        {/* Toggle register/login */}
        <p className="text-center text-xs text-description mt-6">
          {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            onClick={() => {
              setIsRegister(!isRegister);
              setError(null);
            }}
            className="font-semibold text-link hover:underline transition-colors"
          >
            {isRegister ? "Sign in" : "Create one"}
          </button>
        </p>

        {/* Footer */}
        <div className="flex items-center justify-center gap-1.5 mt-8 mb-4">
          <span className="text-description-muted">
            <LockIcon />
          </span>
          <p className="text-2xs text-description-muted">
            Every request scanned for secrets, PII {"\u0026"} prompt injection
          </p>
        </div>
      </div>
    </div>
  );
}
