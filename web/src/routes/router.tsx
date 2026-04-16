import { createBrowserRouter, Navigate } from "react-router-dom";
import { ROUTES } from "../utils/routes";
import { publicRoutes } from "./publicRoutes";
import { privateRoutes } from "./privateRoutes";

/**
 * Single source of truth for the router tree.
 *
 * Structure:
 *   1. Public routes (landing, login, register, 403) — eager, always
 *      registered so unauthenticated users can reach them without a
 *      lazy-chunk round-trip.
 *   2. Private routes (all dashboard surfaces) — registered but
 *      `React.lazy`'d. Each is guarded by `<RequireAuth>` which
 *      redirects to /login with `?next=` if no token is present. The
 *      lazy chunk is only fetched once the guard passes, so an
 *      unauthenticated visitor never downloads private code.
 *   3. Wildcard — anything unmatched bounces to landing.
 *
 * NOTE on ordering: React Router matches in array order and prefers
 * specific paths. Public routes come first so `/` matches the landing
 * page before the private "/" parent (which exists for nested auth
 * surfaces). The landing route has no children so there's no
 * ambiguity — but keep public-first as a rule regardless.
 */
export const router = createBrowserRouter([
  ...publicRoutes,
  ...privateRoutes,
  { path: "*", element: <Navigate to={ROUTES.LANDING} replace /> },
]);
