import { SecurityLockIcon } from "../svg/SecurityLockIcon";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "../../util/navigation";
import { useProxyApi } from "../../hooks/useProxyApi";

interface PerimeterState {
  configured: boolean;
  restricted_count: number;
  blocklist: string[];
  mode: string;
}

export function PerimeterStatus() {
  const navigate = useNavigate();
  const api = useProxyApi();
  const [perimeter, setPerimeter] = useState<PerimeterState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<PerimeterState>("/api/perimeter/status")
      .then((data) => setPerimeter(data))
      .catch((err: unknown) => {
        if (err instanceof Error) {
          console.error("Perimeter status fetch failed:", err.message);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-secondary text-description rounded-lg p-4 text-xs">
        Loading perimeter status...
      </div>
    );
  }

  if (!perimeter) return null;

  return (
    <div className="bg-secondary rounded-lg p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SecurityLockIcon
            size={16}
            color="currentColor"
            className={perimeter.configured ? "text-success" : "text-warning"}
          />
          <span className="text-foreground text-sm font-medium">
            Security Perimeter
          </span>
        </div>
        <button
          onClick={() => navigate(ROUTES.FIRST_LOOK)}
          className="bg-secondary text-foreground border-border hover:bg-secondary-hover focus-visible:ring-border-focus rounded-md border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2"
        >
          {perimeter.configured ? "Edit" : "Set up"}
        </button>
      </div>

      {perimeter.configured ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="bg-success h-2 w-2 rounded-full" />
            <span className="text-description text-xs">
              {perimeter.restricted_count} file pattern
              {perimeter.restricted_count !== 1 ? "s" : ""} restricted
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {perimeter.blocklist.slice(0, 6).map((pattern) => (
              <span
                key={pattern}
                className="bg-success/10 text-success rounded px-1.5 py-0.5 font-mono text-xs"
              >
                {pattern}
              </span>
            ))}
            {perimeter.blocklist.length > 6 && (
              <span className="text-description text-xs">
                +{perimeter.blocklist.length - 6} more
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-warning/10 border-warning/20 flex items-center gap-2 rounded-lg border px-3 py-2">
          <span className="text-warning text-xs">
            No security perimeter configured. Set up file restrictions to
            protect sensitive data.
          </span>
        </div>
      )}
    </div>
  );
}
