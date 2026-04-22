import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownTrayIcon,
  BookOpenIcon,
  CheckCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

import { apiClient } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoints";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { SkeletonList } from "../../components/ui/Skeleton";
import { useAppDispatch } from "../../store/hooks";
import { showToast } from "../../store/slices/uiSlice";

/**
 * User-facing catalogue for org-curated rules + skills.
 *
 * The same component renders both pages — pass `kind="rule"` for
 * /settings/rules and `kind="skill"` for /settings/skills. Each
 * item shows the admin-authored title + description + markdown
 * preview plus an Install / Uninstall toggle.
 *
 * When installed:
 *   - rule  → proxy writes `~/.ai-firewall/rules/<slug>.md`
 *   - skill → proxy writes `~/.ai-firewall/skills/<slug>/SKILL.md`
 *
 * Personal rules / MCP / prompts you author yourself live as local
 * files under `~/.ai-firewall/` and don't appear here — they're
 * strictly client-side.
 */

type Kind = "rule" | "skill";

interface CatalogueItemWithSub {
  id: number;
  orgId: number;
  slug: string;
  title: string;
  description: string | null;
  body: string;
  createdBy: number | null;
  createdAt: number;
  updatedAt: number;
  installed: boolean;
  enabled: boolean;
}

interface ListResponse {
  items: CatalogueItemWithSub[];
}

export default function CataloguePage({ kind }: { kind: Kind }) {
  const dispatch = useAppDispatch();
  const [items, setItems] = useState<CatalogueItemWithSub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const listUrl = kind === "rule" ? ENDPOINTS.me.rules : ENDPOINTS.me.skills;
  const installUrl = (id: number) =>
    kind === "rule" ? ENDPOINTS.me.installRule(id) : ENDPOINTS.me.installSkill(id);

  const label = kind === "rule" ? "Rule" : "Skill";
  const labelPlural = kind === "rule" ? "rules" : "skills";
  const localPath =
    kind === "rule" ? "~/.ai-firewall/rules/<slug>.md" : "~/.ai-firewall/skills/<slug>/SKILL.md";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<ListResponse>(listUrl);
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [listUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  async function install(item: CatalogueItemWithSub) {
    try {
      await apiClient.post(installUrl(item.id), {});
      setItems((prev) =>
        prev.map((x) => (x.id === item.id ? { ...x, installed: true, enabled: true } : x)),
      );
      dispatch(
        showToast({
          id: `cat-inst-${Date.now()}`,
          type: "success",
          message: `Installed ${item.title}`,
        }),
      );
    } catch (e) {
      dispatch(
        showToast({
          id: `cat-inst-err-${Date.now()}`,
          type: "error",
          message: e instanceof Error ? e.message : "Install failed",
        }),
      );
    }
  }

  async function uninstall(item: CatalogueItemWithSub) {
    try {
      await apiClient.del(installUrl(item.id));
      setItems((prev) =>
        prev.map((x) => (x.id === item.id ? { ...x, installed: false, enabled: false } : x)),
      );
      dispatch(
        showToast({
          id: `cat-un-${Date.now()}`,
          type: "success",
          message: `Uninstalled ${item.title}`,
        }),
      );
    } catch (e) {
      dispatch(
        showToast({
          id: `cat-un-err-${Date.now()}`,
          type: "error",
          message: e instanceof Error ? e.message : "Uninstall failed",
        }),
      );
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <SkeletonList count={4} withAvatar={false} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-foreground text-2xl font-bold">{label} catalogue</h1>
        <p className="text-description mt-1 text-sm">
          {labelPlural.charAt(0).toUpperCase() + labelPlural.slice(1)} curated by your org admin.
          Install the ones you want — each one is written to your machine at{" "}
          <span className="font-mono">{localPath}</span> so the IDE and CLI pick them up directly.
        </p>
      </div>

      <div className="border-info/30 bg-info/5 text-description rounded-md border px-3 py-2 text-xs leading-relaxed">
        <span className="text-foreground font-medium">Personal {labelPlural}?</span> Drop your own
        markdown files into{" "}
        <span className="font-mono">
          ~/.ai-firewall/{kind === "rule" ? "rules/" : "skills/<slug>/"}
        </span>
        . They're picked up automatically, never uploaded.
      </div>

      {error && <ErrorBanner message={error} />}

      {items.length === 0 ? (
        <EmptyState
          icon={<BookOpenIcon className="h-12 w-12" />}
          title={`No ${labelPlural} available`}
          description="Ask your org admin to add some under Organization Settings."
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id} padding={false}>
              <div className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-foreground truncate text-sm font-medium">{item.title}</p>
                    <Badge variant="info">{item.slug}</Badge>
                    {item.installed && (
                      <Badge variant="success">
                        <CheckCircleIcon className="mr-1 inline h-3 w-3" />
                        Installed
                      </Badge>
                    )}
                  </div>
                  {item.description && (
                    <p className="text-description mt-1 text-xs">{item.description}</p>
                  )}
                  {expandedId === item.id ? (
                    <pre className="border-border text-description mt-2 overflow-auto whitespace-pre-wrap rounded border p-3 font-mono text-xs">
                      {item.body}
                    </pre>
                  ) : (
                    <p className="text-description-muted mt-1 line-clamp-2 text-xs">
                      {item.body.slice(0, 240)}
                      {item.body.length > 240 ? "…" : ""}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    className="text-info mt-1 text-[11px] hover:underline"
                  >
                    {expandedId === item.id ? "Hide" : "Show full markdown"}
                  </button>
                </div>
                <div className="flex-shrink-0">
                  {item.installed ? (
                    <Button size="sm" variant="ghost" onClick={() => uninstall(item)}>
                      <XMarkIcon className="h-4 w-4" /> Uninstall
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => install(item)}>
                      <ArrowDownTrayIcon className="h-4 w-4" /> Install
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
