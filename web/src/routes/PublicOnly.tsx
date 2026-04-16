import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ROUTES } from "../utils/routes";
import { getToken } from "../utils/storage";

interface PublicOnlyProps {
  children: ReactNode;
  /** Where to send already-authenticated users. Defaults to dashboard. */
  redirectTo?: string;
}

/**
 * Guard for public-only routes (landing, login, register). If the user
 * already has a valid token, bounce them to the dashboard so they don't
 * see a sign-in form they no longer need.
 *
 * Exception: when the page is reached from an IDE/CLI handoff flow
 * (`?from=extension`), we MUST let the already-authenticated user
 * complete sign-in on this page so the token can be relayed to the
 * loopback/vscode:// callback. Redirecting them away breaks the relay.
 *
 * Exception: if the URL carries `?next=<path>`, honor it — a caller
 * deliberately asked for a post-login destination.
 */
export function PublicOnly({ children, redirectTo = ROUTES.DASHBOARD }: PublicOnlyProps) {
  const location = useLocation();
  const token = getToken();

  if (!token) return <>{children}</>;

  const params = new URLSearchParams(location.search);
  if (params.get("from") === "extension") return <>{children}</>;

  const next = params.get("next");
  return <Navigate to={next ?? redirectTo} replace />;
}
