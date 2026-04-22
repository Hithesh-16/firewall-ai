import { useCallback, useEffect, useState } from "react";
import { PencilSquareIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";

import { apiClient } from "../../../api/client";
import { ENDPOINTS } from "../../../api/endpoints";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ErrorBanner } from "../../../components/ui/ErrorBanner";
import { SkeletonList } from "../../../components/ui/Skeleton";
import { useAppDispatch, useAppSelector } from "../../../store/hooks";
import { showToast } from "../../../store/slices/uiSlice";

/**
 * Admin CRUD for the org-curated rules / skills catalogue.
 *
 * Shape: one markdown body per item. Users in the same org browse
 * the same list under Settings → Rules / Settings → Skills and
 * click "Install" to add it to their account. Installed items
 * are mirrored by the proxy to `~/.ai-firewall/rules/<slug>.md`
 * and `~/.ai-firewall/skills/<slug>/SKILL.md` so the IDE + CLI
 * pick them up directly from disk.
 *
 * Personal rules / MCP servers / prompts are NOT shown here — those
 * live as local files under the user's `~/.ai-firewall/` and never
 * round-trip through the backend.
 */

type Kind = "rule" | "skill";

interface CatalogueItem {
  id: number;
  orgId: number;
  slug: string;
  title: string;
  description: string | null;
  body: string;
  createdBy: number | null;
  createdAt: number;
  updatedAt: number;
}

interface ListResponse {
  items: CatalogueItem[];
}

export function OrgCatalogueTab({ kind }: { kind: Kind }) {
  const dispatch = useAppDispatch();
  const currentUser = useAppSelector((s) => s.auth.user);
  const orgId =
    typeof currentUser?.orgId === "number"
      ? String(currentUser.orgId)
      : currentUser?.orgId
        ? String(currentUser.orgId)
        : null;

  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CatalogueItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CatalogueItem | null>(null);

  const endpointList = kind === "rule" ? "rules" : "skills";

  const load = useCallback(async () => {
    if (!orgId) {
      setError("You are not a member of an organization.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const url = kind === "rule" ? ENDPOINTS.orgs.rules(orgId) : ENDPOINTS.orgs.skills(orgId);
      const res = await apiClient.get<ListResponse>(url);
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [kind, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(item: CatalogueItem) {
    if (!orgId) return;
    try {
      const url =
        kind === "rule"
          ? ENDPOINTS.orgs.rule(orgId, item.slug)
          : ENDPOINTS.orgs.skill(orgId, item.slug);
      await apiClient.del(url);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      dispatch(
        showToast({
          id: `cat-del-${Date.now()}`,
          type: "success",
          message: `Removed ${item.title}`,
        }),
      );
    } catch (e) {
      dispatch(
        showToast({
          id: `cat-derr-${Date.now()}`,
          type: "error",
          message: e instanceof Error ? e.message : "Failed to remove",
        }),
      );
    } finally {
      setDeleteTarget(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <SkeletonList count={4} withAvatar={false} />
      </div>
    );
  }

  const label = kind === "rule" ? "Rule" : "Skill";
  const labelPlural = kind === "rule" ? "rules" : "skills";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-foreground text-xl font-semibold">
            Org {labelPlural.charAt(0).toUpperCase() + labelPlural.slice(1)}
          </h2>
          <p className="text-description mt-1 text-sm">
            Admin-curated {labelPlural} your team can install. Each item is a markdown document —
            pick a slug, title, and body below. When a user clicks Install, the file appears on
            their machine at{" "}
            <span className="font-mono">
              ~/.ai-firewall/{kind === "rule" ? "rules/<slug>.md" : "skills/<slug>/SKILL.md"}
            </span>
            .
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          <PlusIcon className="h-4 w-4" />
          New {label}
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}

      {showForm && (
        <CatalogueForm
          kind={kind}
          orgId={orgId}
          initial={editing}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setShowForm(false);
            setEditing(null);
            await load();
            dispatch(
              showToast({
                id: `cat-save-${Date.now()}`,
                type: "success",
                message: `${label} saved`,
              }),
            );
          }}
          onError={(msg) =>
            dispatch(
              showToast({
                id: `cat-err-${Date.now()}`,
                type: "error",
                message: msg,
              }),
            )
          }
        />
      )}

      {items.length === 0 && !showForm ? (
        <EmptyState
          title={`No ${labelPlural} yet`}
          description={`Create a ${label.toLowerCase()} to share it with everyone in your org.`}
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id} padding={false}>
              <div className="flex items-start justify-between px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-foreground truncate text-sm font-medium">{item.title}</p>
                    <Badge variant="info">{item.slug}</Badge>
                  </div>
                  {item.description && (
                    <p className="text-description-muted mt-1 truncate text-xs">
                      {item.description}
                    </p>
                  )}
                  <p className="text-description-muted mt-1 line-clamp-2 text-xs">
                    {item.body.slice(0, 220)}
                    {item.body.length > 220 ? "…" : ""}
                  </p>
                </div>
                <div className="ml-3 flex items-center gap-1">
                  <Button
                    variant="icon"
                    aria-label="Edit"
                    onClick={() => {
                      setEditing(item);
                      setShowForm(true);
                    }}
                  >
                    <PencilSquareIcon className="h-4 w-4" />
                  </Button>
                  <Button variant="icon" aria-label="Delete" onClick={() => setDeleteTarget(item)}>
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        title={`Remove ${label.toLowerCase()}`}
        message={
          deleteTarget
            ? `Remove "${deleteTarget.title}"? Users who already installed it will keep their local copy; new installs will fail.`
            : ""
        }
        confirmLabel="Remove"
        variant="danger"
      />

      {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
      <span className="hidden">{endpointList}</span>
    </div>
  );
}

interface FormProps {
  kind: Kind;
  orgId: string | null;
  initial: CatalogueItem | null;
  onCancel: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}

function CatalogueForm({ kind, orgId, initial, onCancel, onSaved, onError }: FormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setSubmitting(true);
    try {
      const payload = { title, slug: slug.trim() || undefined, description, body };
      if (initial) {
        const url =
          kind === "rule"
            ? ENDPOINTS.orgs.rule(orgId, initial.slug)
            : ENDPOINTS.orgs.skill(orgId, initial.slug);
        await apiClient.put(url, payload);
      } else {
        const url = kind === "rule" ? ENDPOINTS.orgs.rules(orgId) : ENDPOINTS.orgs.skills(orgId);
        await apiClient.post(url, payload);
      }
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        <h3 className="text-foreground mb-1 text-sm font-semibold">
          {initial ? `Edit ${kind}` : `New ${kind}`}
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-description-muted mb-0.5 block text-[11px] font-medium">
              Title
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none focus:ring-1"
            />
          </div>
          <div>
            <label className="text-description-muted mb-0.5 block text-[11px] font-medium">
              Slug {initial && <span>(not editable on rename)</span>}
            </label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="auto-from-title"
              disabled={!!initial}
              className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded-md border px-2 py-1.5 font-mono text-sm focus:outline-none focus:ring-1 disabled:opacity-60"
            />
          </div>
        </div>
        <div>
          <label className="text-description-muted mb-0.5 block text-[11px] font-medium">
            Description (optional, shown above the card)
          </label>
          <input
            value={description ?? ""}
            onChange={(e) => setDescription(e.target.value)}
            className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none focus:ring-1"
          />
        </div>
        <div>
          <label className="text-description-muted mb-0.5 block text-[11px] font-medium">
            Body (markdown)
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            rows={10}
            className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded-md border px-2 py-1.5 font-mono text-sm focus:outline-none focus:ring-1"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={submitting}>
            {initial ? "Save" : "Create"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
