import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheckIcon } from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";
import { useAppDispatch } from "../../store/hooks";
import { setCredentials, setLoading } from "../../store/slices/authSlice";
import { apiClient } from "../../api/client";
import { setToken } from "../../utils/storage";
import type { AuthResponse } from "../../api/types";

type AuthTab = "login" | "register";

interface SSOConfigResponse {
  enabled: boolean;
  provider: string | null;
  providers: string[];
}

const SSO_ICONS: Record<string, { label: string; bg: string; icon: React.ReactNode }> = {
  google: {
    label: "Google",
    bg: "bg-editor hover:bg-list-hover text-foreground border border-border",
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
    bg: "bg-secondary hover:bg-secondary-hover text-foreground",
    icon: (
      <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
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
    bg: "bg-secondary hover:bg-secondary-hover text-foreground",
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
    bg: "bg-primary hover:bg-primary-hover text-primary-foreground",
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

import { config } from "../../config/env";

export function LoginPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const [tab, setTab] = useState<AuthTab>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoadingLocal] = useState(false);
  const [ssoProviders, setSsoProviders] = useState<string[]>([]);

  // Fetch available SSO providers on mount
  useEffect(() => {
    apiClient
      .get<SSOConfigResponse>("/api/auth/sso/config")
      .then((data) => {
        if (data.enabled && data.providers.length > 0) {
          setSsoProviders(data.providers);
        }
      })
      .catch(() => {
        // SSO not available — that's fine, just show email/password
      });
  }, []);

  // Listen for SSO callback postMessage
  useEffect(() => {
    function handleSSOMessage(event: MessageEvent) {
      if (event.data?.type !== "afw-sso-token") return;
      const token = event.data.token as string;
      if (!token) return;

      setToken(token);
      // Validate the token and get user info
      apiClient
        .get<{ user: AuthResponse["user"] }>("/api/auth/me")
        .then((data) => {
          dispatch(setCredentials({ user: data.user, token }));
          navigate("/");
        })
        .catch(() => {
          setError("SSO login succeeded but token validation failed");
        });
    }

    window.addEventListener("message", handleSSOMessage);
    return () => window.removeEventListener("message", handleSSOMessage);
  }, [dispatch, navigate]);

  function handleSSOLogin(provider: string) {
    window.open(
      `${config.proxyBaseUrl}/api/auth/sso/login?provider=${provider}`,
      "afw-sso",
      "width=500,height=700,popup=yes",
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoadingLocal(true);
    dispatch(setLoading(true));

    try {
      let response: AuthResponse;
      if (tab === "login") {
        response = await apiClient.post<AuthResponse>("/api/auth/login", {
          email,
          password,
        });
      } else {
        response = await apiClient.post<AuthResponse>("/api/auth/register", {
          name,
          email,
          password,
        });
      }

      setToken(response.token);
      dispatch(setCredentials({ user: response.user, token: response.token }));
      navigate("/");
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
    <div className="bg-background flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo and heading */}
        <div className="mb-8 flex flex-col items-center">
          <div className="bg-primary/10 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl">
            <ShieldCheckIcon className="text-primary h-9 w-9" />
          </div>
          <h1 className="text-foreground text-2xl font-semibold">Welcome to AI Firewall</h1>
          <p className="text-description mt-2 text-sm">
            Secure your AI workflows with built-in protection
          </p>
        </div>

        {/* Card */}
        <div className="border-border bg-editor rounded-xl border p-8 shadow-2xl">
          {/* SSO Buttons */}
          {ssoProviders.length > 0 && (
            <>
              <div className="mb-6 space-y-3">
                {ssoProviders.map((provider) => {
                  const config = SSO_ICONS[provider];
                  if (!config) return null;
                  return (
                    <button
                      key={provider}
                      type="button"
                      onClick={() => handleSSOLogin(provider)}
                      className={cn(
                        "flex w-full items-center justify-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors",
                        config.bg,
                      )}
                    >
                      {config.icon}
                      Continue with {config.label}
                    </button>
                  );
                })}
              </div>

              {/* Divider */}
              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="border-border w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-editor text-description px-3">or continue with email</span>
                </div>
              </div>
            </>
          )}

          {/* Tab toggle */}
          <div className="bg-secondary mb-6 flex rounded-lg p-1">
            <button
              type="button"
              className={cn(
                "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors",
                tab === "login"
                  ? "bg-editor text-foreground shadow-sm"
                  : "text-description hover:text-foreground",
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
                "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors",
                tab === "register"
                  ? "bg-editor text-foreground shadow-sm"
                  : "text-description hover:text-foreground",
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
            <div className="border-error/30 bg-error/10 text-error mb-4 rounded-lg border px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {tab === "register" && (
              <div>
                <label htmlFor="name" className="text-foreground mb-1.5 block text-sm font-medium">
                  Name
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  required
                  className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded-lg border px-4 py-3 focus:outline-none focus:ring-1"
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="text-foreground mb-1.5 block text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded-lg border px-4 py-3 focus:outline-none focus:ring-1"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="text-foreground mb-1.5 block text-sm font-medium"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={tab === "register" ? "Create a password" : "Enter your password"}
                required
                minLength={tab === "register" ? 8 : undefined}
                className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded-lg border px-4 py-3 focus:outline-none focus:ring-1"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="bg-primary text-primary-foreground hover:bg-primary-hover focus:ring-primary/50 flex w-full items-center justify-center rounded-lg px-4 py-3 font-medium transition-colors focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
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
                  {tab === "login" ? "Signing in..." : "Creating account..."}
                </>
              ) : tab === "login" ? (
                "Sign In"
              ) : (
                "Create Account"
              )}
            </button>
          </form>

          {/* Footer link */}
          <p className="text-description mt-6 text-center text-sm">
            {tab === "login" ? (
              <>
                Don't have an account?{" "}
                <button
                  type="button"
                  className="text-link hover:underline"
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
                  className="text-link hover:underline"
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
        <p className="text-description-muted mt-6 text-center text-xs">
          Protected by AI Firewall. All requests are scanned for security threats.
        </p>
      </div>
    </div>
  );
}
