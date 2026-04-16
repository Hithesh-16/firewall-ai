import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeftIcon, EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";
import { useAppDispatch } from "../../store/hooks";
import { setCredentials, setLoading } from "../../store/slices/authSlice";
import { fetchUserPermissions } from "../../store/slices/permissionsSlice";
import { apiClient } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoints";
import { setToken } from "../../utils/storage";
import { ROUTES } from "../../utils/routes";
import type { AuthResponse } from "../../api/types";
import { config } from "../../config/env";
import { useDocumentHead } from "../../hooks/useDocumentHead";
import AnimatedBackdrop from "../../components/brand/AnimatedBackdrop";
import BrandShield from "../../components/brand/BrandShield";

type AuthTab = "login" | "register";

/**
 * Decodes the `?ext=<base64url>.<hmac>` payload the proxy's
 * /web-login-start route appends to our URL when an extension kicks
 * off a sign-in. We don't bother verifying the HMAC on the client —
 * the only consumer of the decoded fields is the loopback delivery
 * below, which itself validates the `state` nonce end-to-end, so a
 * forged payload just produces a rejected loopback call. The HMAC
 * exists to keep a malicious page from crafting its own redirect
 * that the proxy trusts; by the time we're reading `window.location`
 * we're already past that check.
 */
interface ExtPayload {
  return?: "cli" | "vscode" | "jetbrains";
  callback?: string | null;
  port?: number | null;
  state?: string | null;
  createdAt?: number;
}

function decodeExtPayload(raw: string | null): ExtPayload | null {
  if (!raw) return null;
  const [payload] = raw.split(".");
  if (!payload) return null;
  try {
    // Browsers don't have Buffer, so roll our own base64url → string.
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "===".slice((b64.length + 3) % 4);
    const json = atob(padded);
    return JSON.parse(json) as ExtPayload;
  } catch {
    return null;
  }
}

interface SSOConfigResponse {
  enabled: boolean;
  provider: string | null;
  providers: string[];
}

interface SSOProviderUI {
  label: string;
  icon: React.ReactNode;
}

const SSO_ICONS: Record<string, SSOProviderUI> = {
  google: {
    label: "Google",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
    ),
  },
  github: {
    label: "GitHub",
    icon: (
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  microsoft: {
    label: "Microsoft",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 21 21">
        <rect x="1" y="1" width="9" height="9" fill="#f25022" />
        <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
        <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
        <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
      </svg>
    ),
  },
  oidc: {
    label: "SSO",
    icon: (
      <svg
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
        />
      </svg>
    ),
  },
};

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();

  const [tab, setTab] = useState<AuthTab>(
    location.pathname === ROUTES.REGISTER ? "register" : "login",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoadingLocal] = useState(false);
  const [ssoProviders, setSsoProviders] = useState<string[]>([]);

  // Auth-guard redirection is owned by the `PublicOnly` route wrapper
  // (see src/routes/PublicOnly.tsx). It reads the token synchronously
  // from localStorage and bounces authenticated users to `?next` or
  // the dashboard — no flicker, and no duplicate /api/auth/me call.

  // Crawlers must never index auth surfaces (`noindex`).
  useDocumentHead({
    title: tab === "register" ? "Create account" : "Sign in",
    description: "Sign in to the AI Firewall dashboard to manage policies, scans, and audit logs.",
    index: false,
  });

  // Fetch available SSO providers on mount
  useEffect(() => {
    apiClient
      .get<SSOConfigResponse>(ENDPOINTS.auth.ssoConfig)
      .then((data) => {
        if (data.enabled && data.providers.length > 0) {
          setSsoProviders(data.providers);
        }
      })
      .catch((err: unknown) => {
        console.warn(
          "[LoginPage] Failed to load SSO config from proxy:",
          err instanceof Error ? err.message : err,
        );
      });
  }, []);

  /**
   * Post-success housekeeping shared by every sign-in path:
   *   1. Persist token + user in Redux + localStorage.
   *   2. Tell the proxy to write the shared auth file (best-effort —
   *      fails silently on remote-proxy deployments).
   *   3. If the user came in via /web-login-start (an extension flow),
   *      bounce the token to the loopback / vscode:// callback.
   *   4. Otherwise, navigate to /onboarding (if first-time) or /dashboard.
   */
  async function finishSignIn(user: AuthResponse["user"], token: string) {
    setToken(token);
    dispatch(setCredentials({ user, token }));

    // Load the user's effective permissions into Redux BEFORE any
    // ProtectedRoute / PermissionGate gets a chance to render. Fire
    // and forget — failures are non-fatal (the hooks treat an
    // unfetched list as "no access" which will trigger /403 rather
    // than admit the user falsely).
    dispatch(fetchUserPermissions());

    // Best-effort handoff to local extensions
    try {
      await apiClient.post(ENDPOINTS.auth.handoff, { source: "web" });
    } catch (handoffErr) {
      console.warn(
        "[LoginPage] Local handoff failed (remote proxy?):",
        handoffErr instanceof Error ? handoffErr.message : handoffErr,
      );
    }

    // Step 3: bounce token to extension if `?from=extension` is in the URL.
    //
    // Handoff mechanism: the proxy's `/web-login-start` route signs the
    // callback params (return, port, callback, state) into a base64url
    // payload and appends it to this page as `?ext=<payload>`. We
    // decode it inline — no cross-origin cookie round trip, which was
    // broken in dev because the web dashboard runs on :5174 and the
    // proxy on :8080, and SameSite=Lax cookies are dropped on
    // cross-origin XHR.
    const params = new URLSearchParams(window.location.search);
    if (params.get("from") === "extension") {
      const extRaw = params.get("ext");
      const extInfo = decodeExtPayload(extRaw);
      if (extInfo) {
        if (extInfo.return === "vscode" && extInfo.callback) {
          const stateQs = extInfo.state ? `&state=${encodeURIComponent(extInfo.state)}` : "";
          const target = `${extInfo.callback}?token=${encodeURIComponent(token)}${stateQs}`;
          window.location.replace(target);
          return;
        }
        if ((extInfo.return === "cli" || extInfo.return === "jetbrains") && extInfo.port) {
          // CRITICAL: the loopback server in @ai-firewall/shared-auth
          // strictly validates `state` against the nonce the CLI
          // generated when it opened the browser. Without it, the
          // server 400s and the CLI sits at "Opening browser..."
          // forever because the token delivery never completes.
          const stateQs = extInfo.state ? `&state=${encodeURIComponent(extInfo.state)}` : "";
          try {
            await fetch(
              `http://127.0.0.1:${extInfo.port}/?token=${encodeURIComponent(token)}${stateQs}`,
              { mode: "no-cors" },
            );
          } catch {
            /* loopback delivery is best-effort */
          }
        }
      }
    }

    // Step 4: route based on onboarding status, honoring `?next=` if
    // the login was reached via a private-route redirect.
    if (user.onboardingComplete === false) {
      navigate(ROUTES.ONBOARDING, { replace: true });
      return;
    }
    const nextParam = new URLSearchParams(location.search).get("next");
    const destination = nextParam && nextParam.startsWith("/") ? nextParam : ROUTES.DASHBOARD;
    navigate(destination, { replace: true });
  }

  // Listen for SSO callback postMessage
  useEffect(() => {
    function handleSSOMessage(event: MessageEvent) {
      if (event.data?.type !== "afw-sso-token") return;
      const token = event.data.token as string;
      if (!token) return;

      setToken(token);
      apiClient
        .get<{ user: AuthResponse["user"] }>(ENDPOINTS.auth.me)
        .then((data) => finishSignIn(data.user, token))
        .catch(() => {
          setError("SSO login succeeded but token validation failed");
        });
    }

    window.addEventListener("message", handleSSOMessage);
    return () => window.removeEventListener("message", handleSSOMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, navigate]);

  function handleSSOLogin(provider: string) {
    window.open(
      `${config.proxyBaseUrl}/api/auth/sso/login?provider=${provider}`,
      "afw-sso",
      "width=500,height=700,popup=yes",
    );
  }

  const primaryButtonIdleLabel = tab === "login" ? "Sign In" : "Create Account";
  const primaryButtonBusyLabel = tab === "login" ? "Signing in..." : "Creating account...";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoadingLocal(true);
    dispatch(setLoading(true));

    try {
      let response: AuthResponse;
      if (tab === "login") {
        response = await apiClient.post<AuthResponse>(ENDPOINTS.auth.login, {
          email,
          password,
        });
      } else {
        response = await apiClient.post<AuthResponse>(ENDPOINTS.auth.register, {
          name,
          email,
          password,
        });
      }

      await finishSignIn(response.user, response.token);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred");
      }
    } finally {
      setLoadingLocal(false);
      dispatch(setLoading(false));
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10 text-slate-100">
      <AnimatedBackdrop />

      {/* Back-to-home chip */}
      <Link
        to={ROUTES.LANDING}
        className="absolute left-6 top-6 z-10 inline-flex items-center gap-1.5 rounded-full border border-slate-700/80 bg-slate-900/50 px-3 py-1.5 text-xs text-slate-300 backdrop-blur-sm transition-colors hover:border-emerald-500/50 hover:text-white"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Back to home
      </Link>

      <div className="afw-animate-fade-up relative z-10 w-full max-w-md">
        {/* Logo + heading */}
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandShield size={72} pulse />
          <h1 className="mt-6 text-3xl font-bold tracking-tight text-white">
            {tab === "login" ? "Welcome back" : "Welcome to AI Firewall"}
          </h1>
          <p className="mt-2 max-w-xs text-sm text-slate-400">
            {tab === "login"
              ? "Sign in to your secure AI workspace"
              : "Create an account to start firewalling your AI"}
          </p>
        </div>

        {/* Glass card */}
        <div className="relative rounded-2xl border border-slate-800/80 bg-slate-900/60 p-7 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          {/* Top accent line */}
          <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />

          {/* SSO buttons */}
          {ssoProviders.length > 0 && (
            <>
              <div className="mb-5 space-y-2.5">
                {ssoProviders.map((provider) => {
                  const ui = SSO_ICONS[provider];
                  if (!ui) return null;
                  return (
                    <button
                      key={provider}
                      type="button"
                      onClick={() => handleSSOLogin(provider)}
                      className={cn(
                        "group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-sm font-medium text-slate-100 transition-all",
                        "hover:border-emerald-500/50 hover:bg-slate-900/80 hover:shadow-[0_0_20px_rgba(16,185,129,0.25)]",
                      )}
                    >
                      <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                      {ui.icon}
                      Continue with {ui.label}
                    </button>
                  );
                })}
              </div>

              <div className="relative mb-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-800" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-slate-900/60 px-3 uppercase tracking-wider text-slate-500 backdrop-blur-sm">
                    or continue with email
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Tab toggle */}
          <div className="mb-5 flex rounded-lg border border-slate-800 bg-slate-950/60 p-1">
            <button
              type="button"
              className={cn(
                "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-all",
                tab === "login"
                  ? "bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 text-white shadow-[inset_0_0_0_1px_rgba(16,185,129,0.35)]"
                  : "text-slate-400 hover:text-slate-200",
              )}
              onClick={() => {
                setTab("login");
                setError(null);
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={cn(
                "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-all",
                tab === "register"
                  ? "bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 text-white shadow-[inset_0_0_0_1px_rgba(16,185,129,0.35)]"
                  : "text-slate-400 hover:text-slate-200",
              )}
              onClick={() => {
                setTab("register");
                setError(null);
              }}
            >
              Create Account
            </button>
          </div>

          {/* Error banner */}
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {tab === "register" && (
              <div>
                <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-slate-200">
                  Name
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  required
                  autoComplete="name"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-3 text-slate-100 placeholder:text-slate-500 transition-colors focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-200">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-3 text-slate-100 placeholder:text-slate-500 transition-colors focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-200">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    tab === "register" ? "Create a password (8+ characters)" : "Enter your password"
                  }
                  required
                  minLength={tab === "register" ? 8 : undefined}
                  autoComplete={tab === "register" ? "new-password" : "current-password"}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-3 pr-11 text-slate-100 placeholder:text-slate-500 transition-colors focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 transition-colors hover:text-slate-200"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeSlashIcon className="h-5 w-5" />
                  ) : (
                    <EyeIcon className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className={cn(
                "relative flex w-full items-center justify-center overflow-hidden rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all",
                "bg-gradient-to-r from-emerald-500 to-cyan-500",
                "shadow-[0_0_30px_rgba(16,185,129,0.35)]",
                "hover:scale-[1.02] hover:shadow-[0_0_40px_rgba(16,185,129,0.5)]",
                "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100",
              )}
            >
              {loading ? (
                <>
                  <svg
                    className="mr-2 h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  {primaryButtonBusyLabel}
                </>
              ) : (
                primaryButtonIdleLabel
              )}
            </button>
          </form>

          {/* Footer link */}
          <p className="mt-6 text-center text-sm text-slate-400">
            {tab === "login" ? (
              <>
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  className="font-medium text-emerald-400 transition-colors hover:text-emerald-300"
                  onClick={() => {
                    setTab("register");
                    setError(null);
                  }}
                >
                  Create one
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  className="font-medium text-emerald-400 transition-colors hover:text-emerald-300"
                  onClick={() => {
                    setTab("login");
                    setError(null);
                  }}
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>

        {/* Bottom text */}
        <p className="mt-6 text-center text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Protected by AI Firewall. Every request is scanned.
          </span>
        </p>
      </div>
    </div>
  );
}
