import { FormEvent, useEffect, useState } from "react";

const PROXY_BASE = (window as any).__PROXY_URL ?? "http://localhost:8080";

interface AuthResponse {
  user: {
    id: number;
    email: string;
    name: string;
    role: string;
    orgId: number | null;
  };
  token: string;
}

/* ── Brand SVG Icons ─────────────────────────────────────────────────── */

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59a14.5 14.5 0 010-9.18l-7.98-6.19a24.08 24.08 0 000 21.56l7.98-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 23 23">
      <rect fill="#f25022" x="1" y="1" width="10" height="10" />
      <rect fill="#00a4ef" x="1" y="12" width="10" height="10" />
      <rect fill="#7fba00" x="12" y="1" width="10" height="10" />
      <rect fill="#ffb900" x="12" y="12" width="10" height="10" />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
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

/* ── Feature Card Data ───────────────────────────────────────────────── */

const FEATURES = [
  {
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
    ),
    title: "Secret Scanner",
    count: "12 patterns",
    description:
      "AWS keys, private keys, JWTs, database URLs, GitHub tokens, and more. Critical secrets are always blocked.",
  },
  {
    icon: (
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
    title: "PII Detection",
    count: "7 patterns",
    description:
      "Email, phone, SSN, Aadhaar, PAN, credit cards with Luhn validation, and IP addresses.",
  },
  {
    icon: (
      <svg
        width="24"
        height="24"
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
    ),
    title: "Prompt Injection",
    count: "23 categories",
    description:
      "Jailbreaks, instruction overrides, data exfiltration, encoding bypasses, and supply-chain injection.",
  },
];

const STATS = [
  { label: "LLM Providers", value: "60+" },
  { label: "Agent Tools", value: "26" },
  { label: "Context Providers", value: "40+" },
];

/* ── Glass Styles ────────────────────────────────────────────────────── */

const glassCard =
  "backdrop-blur-xl bg-white/[0.035] border border-white/[0.08] rounded-2xl shadow-2xl";
const glassInput =
  "w-full bg-white/[0.04] text-white border border-white/[0.1] rounded-xl px-4 py-3 text-sm placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all duration-200";
const glassButton =
  "flex items-center gap-3 w-full rounded-xl px-4 py-3 text-sm font-medium bg-white/[0.04] text-slate-200 border border-white/[0.08] hover:bg-white/[0.08] hover:border-white/[0.12] active:scale-[0.98] transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none";

/* ── Main Component ──────────────────────────────────────────────────── */

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

  return (
    <div className="min-h-screen overflow-auto bg-slate-950">
      {/* ── Background Gradient + Glow ─────────────────────────────── */}
      <div className="fixed inset-0 bg-gradient-to-br from-slate-950 via-emerald-950/20 to-slate-950" />
      <div className="pointer-events-none fixed left-1/2 top-1/4 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/[0.07] blur-[120px]" />
      <div className="pointer-events-none fixed bottom-0 right-0 h-[400px] w-[400px] rounded-full bg-emerald-600/[0.04] blur-[100px]" />

      {/* ── Content ────────────────────────────────────────────────── */}
      <div className="relative z-10">
        {/* ── Nav Bar ──────────────────────────────────────────────── */}
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 lg:px-12">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <span className="text-lg font-semibold tracking-tight text-white">
              AI Firewall
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-slate-400 transition-colors hover:text-white"
            >
              GitHub
            </a>
            <a
              href="/docs"
              className="text-sm text-slate-400 transition-colors hover:text-white"
            >
              Docs
            </a>
          </div>
        </nav>

        {/* ── Hero Section ─────────────────────────────────────────── */}
        <section className="mx-auto max-w-7xl px-6 pb-20 pt-12 lg:px-12 lg:pt-24">
          <div className="grid items-start gap-12 lg:grid-cols-2 lg:gap-20">
            {/* Left — Headline + Stats */}
            <div className="flex flex-col justify-center lg:pt-8">
              <div className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                Open Source Security Proxy
              </div>

              <h1 className="mb-5 text-4xl font-bold leading-[1.1] tracking-tight text-white lg:text-5xl">
                Secure every AI request
                <span className="mt-2 block text-2xl font-normal text-slate-400 lg:text-3xl">
                  before it leaves your machine
                </span>
              </h1>

              <p className="mb-8 max-w-lg text-base leading-relaxed text-slate-400">
                Every LLM request, file read, and MCP tool call passes through a
                local security proxy that scans for secrets, PII, and prompt
                injection.
              </p>

              {/* Stat Pills */}
              <div className="mb-8 flex flex-wrap gap-3">
                {STATS.map((stat) => (
                  <div
                    key={stat.label}
                    className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.04] px-4 py-2 text-sm"
                  >
                    <span className="font-semibold text-white">
                      {stat.value}
                    </span>
                    <span className="text-slate-500">{stat.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right — Login Card */}
            <div className={`${glassCard} p-7 lg:p-8`}>
              <div className="mb-6 text-center">
                <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 shadow-[0_0_40px_rgba(16,185,129,0.12)]">
                  <svg
                    width="24"
                    height="24"
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
                </div>
                <h2 className="text-xl font-semibold text-white">
                  {isRegister ? "Create your account" : "Welcome back"}
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  {isRegister
                    ? "Get started with AI Firewall"
                    : "Sign in to your dashboard"}
                </p>
              </div>

              {/* Error */}
              {error && (
                <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-xs text-red-400">
                  <svg
                    className="mt-0.5 h-4 w-4 flex-shrink-0"
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
                <button
                  onClick={() => handleSSO("google")}
                  disabled={ssoLoading !== null}
                  className={glassButton}
                >
                  <GoogleIcon />
                  <span className="flex-1 text-left">
                    {ssoLoading === "google"
                      ? "Connecting..."
                      : "Continue with Google"}
                  </span>
                  {ssoLoading === "google" && <LoadingSpinner />}
                </button>
                <button
                  onClick={() => handleSSO("github")}
                  disabled={ssoLoading !== null}
                  className={glassButton}
                >
                  <GitHubIcon />
                  <span className="flex-1 text-left">
                    {ssoLoading === "github"
                      ? "Connecting..."
                      : "Continue with GitHub"}
                  </span>
                  {ssoLoading === "github" && <LoadingSpinner />}
                </button>
                <button
                  onClick={() => handleSSO("microsoft")}
                  disabled={ssoLoading !== null}
                  className={glassButton}
                >
                  <MicrosoftIcon />
                  <span className="flex-1 text-left">
                    {ssoLoading === "microsoft"
                      ? "Connecting..."
                      : "Continue with Microsoft"}
                  </span>
                  {ssoLoading === "microsoft" && <LoadingSpinner />}
                </button>
              </div>

              {/* Divider */}
              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-white/[0.08]" />
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
                  or
                </span>
                <div className="h-px flex-1 bg-white/[0.08]" />
              </div>

              {/* Email/Password Form */}
              <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                {isRegister && (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-400">
                      Full name
                    </label>
                    <input
                      className={glassInput}
                      placeholder="Jane Doe"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      autoComplete="name"
                    />
                  </div>
                )}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">
                    Email
                  </label>
                  <input
                    className={glassInput}
                    placeholder="you@company.com"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">
                    Password
                  </label>
                  <input
                    className={glassInput}
                    placeholder={
                      isRegister ? "Min 8 characters" : "Enter password"
                    }
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={isRegister ? 8 : undefined}
                    autoComplete={
                      isRegister ? "new-password" : "current-password"
                    }
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all duration-150 hover:bg-emerald-400 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                >
                  {loading && <LoadingSpinner />}
                  {loading
                    ? "Please wait..."
                    : isRegister
                      ? "Create Account"
                      : "Sign In"}
                </button>
              </form>

              {/* Toggle */}
              <p className="mt-5 text-center text-xs text-slate-500">
                {isRegister
                  ? "Already have an account?"
                  : "Don't have an account?"}{" "}
                <button
                  onClick={() => {
                    setIsRegister(!isRegister);
                    setError(null);
                  }}
                  className="font-semibold text-emerald-400 transition-colors hover:text-emerald-300"
                >
                  {isRegister ? "Sign in" : "Create one"}
                </button>
              </p>
            </div>
          </div>
        </section>

        {/* ── Feature Cards ────────────────────────────────────────── */}
        <section className="mx-auto max-w-7xl px-6 pb-20 lg:px-12">
          <div className="grid gap-5 md:grid-cols-3">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className={`${glassCard} group p-6 transition-all duration-300 hover:border-white/[0.12] hover:bg-white/[0.05]`}
              >
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 transition-colors group-hover:bg-emerald-500/15">
                    {feature.icon}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      {feature.title}
                    </h3>
                    <span className="text-xs font-medium text-emerald-400">
                      {feature.count}
                    </span>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-slate-400">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Footer ───────────────────────────────────────────────── */}
        <footer className="mx-auto max-w-7xl px-6 pb-10 lg:px-12">
          <div className="flex flex-col items-center justify-between gap-3 border-t border-white/[0.06] pt-6 sm:flex-row">
            <p className="text-xs text-slate-500">
              Open source &middot; Local-first &middot; 60+ LLM providers
            </p>
            <p className="text-xs text-slate-600">
              Every request scanned for secrets, PII &amp; prompt injection
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
