import { Link } from "react-router-dom";
import { NoSymbolIcon } from "@heroicons/react/24/outline";
import { useAppSelector } from "../store/hooks";
import { ROUTES } from "../utils/routes";

/**
 * 403 page rendered by <ProtectedRoute> when the current user lacks
 * a required permission. Spec rule: never show a blank page — show
 * the role name and prompt the user to contact their admin.
 */
export function ForbiddenPage() {
  const user = useAppSelector((s) => s.auth.user);
  const roleLabel = user?.role ?? "your current role";

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-6">
      <div className="border-border bg-editor max-w-md rounded-xl border p-8 text-center shadow-lg">
        <div className="bg-error/10 mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full">
          <NoSymbolIcon className="text-error h-7 w-7" />
        </div>
        <h1 className="text-foreground mb-2 text-xl font-semibold">
          You don&apos;t have permission to perform this action.
        </h1>
        <p className="text-description mt-1 text-sm">
          Your role is{" "}
          <span className="text-foreground font-medium">{roleLabel}</span>.
          If you believe this is wrong, contact your organization admin to
          request access.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            to={ROUTES.CHAT}
            className="bg-primary text-primary-foreground hover:bg-primary-hover rounded-lg px-4 py-2 text-sm font-medium"
          >
            Back to dashboard
          </Link>
          <Link
            to={ROUTES.SETTINGS}
            className="text-description hover:text-foreground rounded-lg px-4 py-2 text-sm"
          >
            View account
          </Link>
        </div>
      </div>
    </div>
  );
}

export default ForbiddenPage;
