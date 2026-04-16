import type { RouteObject } from "react-router-dom";
import { LoginPage } from "../pages/auth/LoginPage";
import { LandingPage } from "../pages/landing/LandingPage";
import { ForbiddenPage } from "../pages/ForbiddenPage";
import { ROUTES } from "../utils/routes";
import { PublicOnly } from "./PublicOnly";

/**
 * Public routes are eagerly imported: these are the ONLY pages an
 * unauthenticated user can hit, and they form the initial paint. Any
 * code-splitting here would add a loading flash for every first-time
 * visitor — worse UX for the tiny bundle saving.
 *
 * `PublicOnly` wraps landing/login/register so a logged-in user who
 * manually types `/login` is redirected to the dashboard instead of
 * seeing a sign-in form they don't need.
 *
 * The 403 page is NOT wrapped — it should render for both auth states
 * because it is the landing target for capability denials.
 */
export const publicRoutes: RouteObject[] = [
  {
    path: ROUTES.LANDING,
    element: (
      <PublicOnly>
        <LandingPage />
      </PublicOnly>
    ),
  },
  {
    path: ROUTES.LOGIN,
    element: (
      <PublicOnly>
        <LoginPage />
      </PublicOnly>
    ),
  },
  {
    path: ROUTES.REGISTER,
    element: (
      <PublicOnly>
        <LoginPage />
      </PublicOnly>
    ),
  },
  {
    path: ROUTES.FORBIDDEN,
    element: <ForbiddenPage />,
  },
];
