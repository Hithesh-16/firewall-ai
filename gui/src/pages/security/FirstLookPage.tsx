import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "../../util/navigation";
import { useProxyApi } from "../../hooks/useProxyApi";

interface DetectedPattern {
  pattern: string;
  category: string;
  description: string;
  recommended: boolean;
  active: boolean;
}

const CATEGORY_CONFIG: Record<
  string,
  { label: string; color: string; icon: string }
> = {
  secrets: { label: "Secrets & Keys", color: "text-error", icon: "\u{1F512}" },
  certificates: { label: "Certificates", color: "text-warning", icon: "\u{1F4DC}" },
  config: { label: "Configuration", color: "text-warning", icon: "\u2699\uFE0F" },
  dependencies: { label: "Dependencies", color: "text-info", icon: "\u{1F4E6}" },
  build: { label: "Build Output", color: "text-description-muted", icon: "\u{1F3D7}\uFE0F" },
  internal: { label: "Internal Files", color: "text-description", icon: "\u{1F527}" },
};

function FirstLookPage() {
  const navigate = useNavigate();
  const api = useProxyApi();
  const [patterns, setPatterns] = useState<DetectedPattern[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDetectedPatterns();
  }, []);

  async function fetchDetectedPatterns() {
    try {
      const data = await api.get<{ patterns: DetectedPattern[] }>("/api/perimeter/detect");
      const detected = data.patterns;
      setPatterns(detected);
      const initial = new Set<string>();
      for (const p of detected) {
        if (p.recommended || p.active) {
          initial.add(p.pattern);
        }
      }
      setSelected(initial);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not reach AI Firewall proxy.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  const toggle = useCallback(
    (pattern: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(pattern)) {
          next.delete(pattern);
        } else {
          next.add(pattern);
        }
        return next;
      });
    },
    [],
  );

  const selectAll = useCallback(() => {
    setSelected(new Set(patterns.map((p) => p.pattern)));
  }, [patterns]);

  const deselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  async function confirmPerimeter() {
    setConfirming(true);
    try {
      await api.post("/api/perimeter/confirm", {
        restricted: Array.from(selected),
      });
      navigate(ROUTES.SECURITY);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save security perimeter.";
      setError(message);
    } finally {
      setConfirming(false);
    }
  }

  // Group patterns by category
  const grouped = patterns.reduce<Record<string, DetectedPattern[]>>(
    (acc, p) => {
      const cat = p.category || "other";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(p);
      return acc;
    },
    {},
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-description text-sm">Scanning workspace...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-5">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => navigate(ROUTES.HOME)}
            className="text-description hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
            aria-label="Back to chat"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
            </svg>
          </button>
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              className="text-primary-foreground"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">
              Security Perimeter Setup
            </h1>
            <p className="text-xs text-description">
              Choose which files AI models should never see
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-error/5 border border-error/30 rounded-lg px-3 py-2 mb-3">
            <p className="text-xs text-error">{error}</p>
          </div>
        )}

        <p className="text-xs text-description leading-relaxed">
          AI Firewall detected sensitive file patterns in your workspace.
          Restricted files will be{" "}
          <span className="text-error font-medium">blocked</span> from all AI
          requests across every connected client (VS Code, CLI, JetBrains, browser).
        </p>
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <button
          onClick={selectAll}
          className="text-xs bg-secondary text-foreground px-2 py-1 rounded-md border border-border hover:bg-secondary-hover transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
        >
          Select all
        </button>
        <span className="text-description text-xs">/</span>
        <button
          onClick={deselectAll}
          className="text-xs bg-secondary text-foreground px-2 py-1 rounded-md border border-border hover:bg-secondary-hover transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
        >
          Deselect all
        </button>
        <span className="flex-1" />
        <span className="text-xs text-description">
          {selected.size} of {patterns.length} restricted
        </span>
      </div>

      {/* Pattern list grouped by category */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {Object.entries(grouped).map(([category, categoryPatterns]) => {
          const config = CATEGORY_CONFIG[category] ?? {
            label: category,
            color: "text-description",
            icon: "\u{1F4C1}",
          };
          const allSelected = categoryPatterns.every((p) =>
            selected.has(p.pattern),
          );

          return (
            <div key={category}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm">{config.icon}</span>
                <span
                  className={`text-xs font-semibold uppercase tracking-wider ${config.color}`}
                >
                  {config.label}
                </span>
                <button
                  onClick={() => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      for (const p of categoryPatterns) {
                        if (allSelected) {
                          next.delete(p.pattern);
                        } else {
                          next.add(p.pattern);
                        }
                      }
                      return next;
                    });
                  }}
                  className="text-xs bg-secondary text-description px-2 py-0.5 rounded border border-border hover:text-foreground hover:bg-secondary-hover ml-auto transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
                >
                  {allSelected ? "Deselect group" : "Select group"}
                </button>
              </div>

              <div className="space-y-1">
                {categoryPatterns.map((p) => {
                  const isSelected = selected.has(p.pattern);
                  return (
                    <button
                      key={p.pattern}
                      onClick={() => toggle(p.pattern)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none ${
                        isSelected
                          ? "border-success/40 bg-success/5"
                          : "border-border bg-secondary hover:border-border"
                      }`}
                    >
                      {/* Lock/unlock indicator */}
                      <div
                        className={`w-5 h-5 rounded flex items-center justify-center text-xs ${
                          isSelected
                            ? "bg-success/15 text-success"
                            : "bg-secondary text-description"
                        }`}
                      >
                        {isSelected ? "\u{1F512}" : "\u{1F513}"}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-mono truncate ${
                            isSelected ? "text-foreground" : "text-description"
                          }`}
                        >
                          {p.pattern}
                        </p>
                        <p className="text-xs text-description truncate">
                          {p.description}
                        </p>
                      </div>

                      {/* Status badge */}
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          isSelected
                            ? "bg-success/15 text-success"
                            : "bg-secondary text-description"
                        }`}
                      >
                        {isSelected ? "Locked" : "Exposed"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sticky footer */}
      <div className="sticky bottom-0 bg-background border-t border-border px-4 py-4 space-y-2">
        <button
          onClick={confirmPerimeter}
          disabled={confirming}
          className="w-full py-2.5 rounded-lg bg-primary hover:bg-primary-hover text-primary-foreground text-sm font-semibold transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
        >
          {confirming
            ? "Saving..."
            : `Confirm Security Perimeter (${selected.size} restricted)`}
        </button>
        <button
          onClick={() => navigate(ROUTES.HOME)}
          className="w-full py-2 text-xs text-description hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}

export default FirstLookPage;
