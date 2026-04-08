import { Link, useNavigate } from "react-router-dom";
import {
  ShieldCheckIcon,
  LockClosedIcon,
  BoltIcon,
  EyeIcon,
  CubeTransparentIcon,
  CpuChipIcon,
  ArrowRightIcon,
  CommandLineIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import { useEffect } from "react";
import { ROUTES } from "../../utils/routes";
import { useAppSelector } from "../../store/hooks";
import AnimatedBackdrop from "../../components/brand/AnimatedBackdrop";
import BrandShield from "../../components/brand/BrandShield";

const FEATURES = [
  {
    icon: ShieldCheckIcon,
    title: "Scan Before You Send",
    body: "Every prompt passes through 23 injection categories, 12 secret patterns, 7 PII scanners, and unicode normalization — before it ever reaches an LLM provider.",
  },
  {
    icon: LockClosedIcon,
    title: "Reversible PII Vault",
    body: "Zero-knowledge tokenization replaces sensitive data with deterministic HMAC tokens and restores it after the response. The LLM never sees the raw values.",
  },
  {
    icon: BoltIcon,
    title: "Token Intelligence",
    body: "Real tiktoken counting, advisory context-window checks, and cost-aware routing. No silent truncation, no bill shock.",
  },
  {
    icon: EyeIcon,
    title: "MCP Security Gateway",
    body: "Scan every MCP tool input and output with a full audit trail. The only open-source firewall that inspects MCP traffic.",
  },
  {
    icon: CubeTransparentIcon,
    title: "Multi-Provider Routing",
    body: "OpenAI, Anthropic, Gemini, Ollama — one gateway, risk-based routing, BYOK credentials in an AES-256-GCM vault.",
  },
  {
    icon: CpuChipIcon,
    title: "Red Team Agent",
    body: "Continuous adversarial testing with 62 probes across 10 attack categories. Catch regressions before attackers do.",
  },
];

const EXTENSIONS = [
  { label: "VS Code", icon: CommandLineIcon },
  { label: "JetBrains", icon: CommandLineIcon },
  { label: "CLI Agent", icon: CommandLineIcon },
  { label: "Web Dashboard", icon: DocumentTextIcon },
];

export function LandingPage() {
  const navigate = useNavigate();
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);

  // If already signed in, skip landing and go straight to the dashboard.
  useEffect(() => {
    if (isAuthenticated) {
      navigate(ROUTES.CHAT, { replace: true });
    }
  }, [isAuthenticated, navigate]);

  return (
    <div className="relative min-h-screen text-slate-100">
      <AnimatedBackdrop />

      {/* ───────── Nav ───────── */}
      <nav className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link to={ROUTES.LANDING} className="flex items-center gap-3 group">
          <div className="relative">
            <BrandShield size={38} pulse={false} />
          </div>
          <span className="text-lg font-semibold tracking-tight text-white">AI Firewall</span>
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          <a href="#features" className="text-sm text-slate-300 transition-colors hover:text-white">
            Features
          </a>
          <a
            href="#extensions"
            className="text-sm text-slate-300 transition-colors hover:text-white"
          >
            Extensions
          </a>
          <a
            href="https://github.com/ai-firewall"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-slate-300 transition-colors hover:text-white"
          >
            Docs
          </a>
          <a
            href="https://github.com/ai-firewall"
            target="_blank"
            rel="noreferrer"
            className="text-sm text-slate-300 transition-colors hover:text-white"
          >
            GitHub
          </a>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to={ROUTES.LOGIN}
            className="hidden rounded-lg px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:text-white sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            to={ROUTES.REGISTER}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_20px_rgba(16,185,129,0.35)] transition-transform hover:scale-[1.03]"
          >
            Get Started
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </nav>

      {/* ───────── Hero ───────── */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-16 pt-12 text-center sm:pt-20">
        <div className="afw-animate-fade-up mb-6 flex justify-center">
          <BrandShield size={96} pulse />
        </div>

        <div className="afw-animate-fade-up-delay-1 mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
          <span className="relative inline-flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          Proxy online — every LLM call is scanned
        </div>

        <h1 className="afw-animate-fade-up-delay-1 mx-auto max-w-4xl text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl md:text-6xl">
          The open-source security layer for{" "}
          <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
            every AI request
          </span>
        </h1>

        <p className="afw-animate-fade-up-delay-2 mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
          Block secrets, redact PII, stop prompt injection, and audit every MCP tool call — before a
          single token reaches OpenAI, Anthropic, Gemini, or any local model. One gateway, your
          keys, your rules.
        </p>

        <div className="afw-animate-fade-up-delay-3 mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            to={ROUTES.REGISTER}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-7 py-3.5 text-sm font-semibold text-white shadow-[0_0_30px_rgba(16,185,129,0.45)] transition-transform hover:scale-[1.04]"
          >
            Create free account
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
          <Link
            to={ROUTES.LOGIN}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-7 py-3.5 text-sm font-semibold text-slate-100 backdrop-blur-sm transition-colors hover:border-slate-500 hover:bg-slate-800/60"
          >
            Sign in
          </Link>
        </div>

        {/* Stats strip */}
        <div className="afw-animate-fade-up-delay-3 mx-auto mt-16 grid max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4">
          {[
            { label: "Scanners", value: "50+" },
            { label: "LLM Providers", value: "60+" },
            { label: "Injection Patterns", value: "23" },
            { label: "Audit Categories", value: "10" },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 backdrop-blur-sm"
            >
              <div className="text-2xl font-bold text-white">{s.value}</div>
              <div className="mt-0.5 text-xs text-slate-400">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── Features ───────── */}
      <section id="features" className="relative z-10 mx-auto max-w-6xl px-6 py-20">
        <div className="mb-12 text-center">
          <div className="mb-3 inline-block rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium uppercase tracking-wider text-emerald-300">
            Features
          </div>
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Everything a security-conscious team needs
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-slate-400">
            Built-in scanners, policy engine, vault, audit log, and a control plane — no separate
            security stack required.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 p-6 backdrop-blur-sm transition-all hover:-translate-y-1 hover:border-emerald-500/40 hover:bg-slate-900/70 hover:shadow-[0_10px_40px_rgba(16,185,129,0.15)]"
            >
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 text-emerald-300 ring-1 ring-emerald-500/30">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="text-lg font-semibold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── Extensions ───────── */}
      <section id="extensions" className="relative z-10 mx-auto max-w-6xl px-6 py-20">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Works everywhere you write code
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-slate-400">
            Same firewall, same policy, same audit log — across your IDE, your terminal, and the
            browser dashboard.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {EXTENSIONS.map(({ label, icon: Icon }) => (
            <div
              key={label}
              className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-4 backdrop-blur-sm transition-colors hover:border-emerald-500/40 hover:bg-slate-900/70"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800/80 text-emerald-300">
                <Icon className="h-5 w-5" />
              </div>
              <span className="text-sm font-medium text-slate-100">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── CTA banner ───────── */}
      <section className="relative z-10 mx-auto max-w-4xl px-6 py-20">
        <div className="relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-slate-900/60 to-cyan-500/15 p-10 text-center backdrop-blur-md shadow-[0_20px_60px_rgba(16,185,129,0.2)]">
          <div
            aria-hidden
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 20%, rgba(16,185,129,0.35), transparent 40%), radial-gradient(circle at 80% 80%, rgba(6,182,212,0.35), transparent 40%)",
            }}
          />
          <div className="relative">
            <h2 className="text-2xl font-bold text-white sm:text-3xl">
              Ready to firewall your AI?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-slate-300">
              Run the proxy locally in under a minute. Self-hosted, open source, with your API keys
              in an encrypted vault.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Link
                to={ROUTES.REGISTER}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 px-7 py-3.5 text-sm font-semibold text-white shadow-[0_0_30px_rgba(16,185,129,0.45)] transition-transform hover:scale-[1.04]"
              >
                Create account
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
              <a
                href="https://github.com/ai-firewall"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-7 py-3.5 text-sm font-semibold text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-800/60"
              >
                View on GitHub
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ───────── Footer ───────── */}
      <footer className="relative z-10 border-t border-slate-800/60 bg-slate-950/40 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-6 sm:flex-row">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <BrandShield size={22} pulse={false} />
            <span>AI Firewall — open-source AI security proxy</span>
          </div>
          <div className="flex items-center gap-5 text-xs text-slate-500">
            <a href="#features" className="hover:text-slate-300">
              Features
            </a>
            <a
              href="https://github.com/ai-firewall"
              target="_blank"
              rel="noreferrer"
              className="hover:text-slate-300"
            >
              Docs
            </a>
            <Link to={ROUTES.LOGIN} className="hover:text-slate-300">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
