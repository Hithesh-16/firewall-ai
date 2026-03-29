import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "../../util/navigation";

const PROXY_URL = "http://localhost:8080";

interface PerimeterState {
  configured: boolean;
  restricted_count: number;
  blocklist: string[];
  mode: string;
}

export function PerimeterStatus() {
  const navigate = useNavigate();
  const [perimeter, setPerimeter] = useState<PerimeterState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${PROXY_URL}/api/perimeter/status`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setPerimeter(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-secondary rounded-lg p-4 text-xs text-description">
        Loading perimeter status...
      </div>
    );
  }

  if (!perimeter) return null;

  return (
    <div className="bg-secondary rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={perimeter.configured ? "text-success" : "text-warning"}
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span className="text-sm font-medium text-foreground">
            Security Perimeter
          </span>
        </div>
        <button
          onClick={() => navigate(ROUTES.FIRST_LOOK)}
          className="bg-secondary text-foreground text-xs px-2.5 py-1 rounded-md border border-border hover:bg-secondary-hover transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
        >
          {perimeter.configured ? "Edit" : "Set up"}
        </button>
      </div>

      {perimeter.configured ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-success" />
            <span className="text-xs text-description">
              {perimeter.restricted_count} file pattern{perimeter.restricted_count !== 1 ? "s" : ""} restricted
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {perimeter.blocklist.slice(0, 6).map((pattern) => (
              <span
                key={pattern}
                className="text-xs bg-success/10 text-success px-1.5 py-0.5 rounded font-mono"
              >
                {pattern}
              </span>
            ))}
            {perimeter.blocklist.length > 6 && (
              <span className="text-xs text-description">
                +{perimeter.blocklist.length - 6} more
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
          <span className="text-warning text-xs">
            No security perimeter configured. Set up file restrictions to protect sensitive data.
          </span>
        </div>
      )}
    </div>
  );
}
