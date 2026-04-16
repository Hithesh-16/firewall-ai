import { useState } from "react";
import {
  PlusIcon,
  XMarkIcon,
  EnvelopeIcon,
  ClipboardIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { onboardingActions } from "../../store/slices/onboardingSlice";
import { apiClient } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoints";
import { WizardCard, WizardError, WizardNav, slugify, tinyId } from "./_shared";

type Role = "admin" | "security_lead" | "developer" | "auditor";
const ROLES: Role[] = ["admin", "security_lead", "developer", "auditor"];

interface CreateTeamResponse {
  id: number;
  name: string;
  slug: string;
}

interface CreateInviteResponse {
  ok: boolean;
  invite: {
    token: string;
    url: string;
    email: string;
    role: Role;
    orgId: number;
    orgName: string;
    expiresAt: number;
  };
}

/**
 * Step 3 — Teams & members.
 *
 * This step is intentionally soft: everything is optional, the user can
 * skip it entirely and add teams + invites later from Settings. The
 * Continue button is always enabled.
 *
 * Individual workspaces never see this step (the wizard router skips it).
 */
export function Step3Teams({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const dispatch = useAppDispatch();
  const wizard = useAppSelector((s) => s.onboarding);
  const orgId = wizard.org.id;

  const [teamDraft, setTeamDraft] = useState({ name: "", slug: "" });
  const [inviteDraft, setInviteDraft] = useState<{
    email: string;
    role: Role;
  }>({ email: "", role: "developer" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  async function handleAddTeam() {
    if (!orgId) {
      setError("Org not created yet — go back to Step 1.");
      return;
    }
    if (!teamDraft.name.trim()) return;
    setError(null);
    setBusy(true);
    try {
      // Note: the proxy POST /api/teams endpoint derives orgId from the
      // authenticated user — it intentionally ignores any orgId in the
      // body. We just need name + slug.
      const resp = await apiClient.post<CreateTeamResponse>(ENDPOINTS.teams, {
        name: teamDraft.name.trim(),
        slug: teamDraft.slug.trim() || slugify(teamDraft.name),
      });
      dispatch(
        onboardingActions.addTeam({
          localId: tinyId(),
          serverId: resp.id,
          name: resp.name,
          slug: resp.slug,
        }),
      );
      setTeamDraft({ name: "", slug: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create team");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddInvite() {
    if (!orgId) return;
    if (!inviteDraft.email.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const resp = await apiClient.post<CreateInviteResponse>(
        ENDPOINTS.orgs.invites(String(orgId)),
        {
          email: inviteDraft.email.trim().toLowerCase(),
          role: inviteDraft.role,
        },
      );
      dispatch(
        onboardingActions.addInvite({
          email: resp.invite.email,
          role: resp.invite.role,
          inviteUrl: resp.invite.url,
        }),
      );
      setInviteDraft({ email: "", role: "developer" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invite");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite(url: string, idx: number) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1800);
    } catch {
      /* ignore */
    }
  }

  return (
    <WizardCard
      title="Teams & members"
      subtitle="Create teams and invite your colleagues. All of this is optional — you can add more later from Settings."
    >
      {/* Teams */}
      {wizard.workspaceType === "organization" && (
        <div className="mb-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Teams
          </h3>
          <div className="space-y-2">
            {wizard.teams.map((t) => (
              <div
                key={t.localId}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm"
              >
                <div>
                  <span className="text-slate-100">{t.name}</span>
                  <span className="ml-2 text-xs text-slate-500">/{t.slug}</span>
                </div>
                <button
                  onClick={() => dispatch(onboardingActions.removeTeam(t.localId))}
                  className="text-slate-500 hover:text-red-400"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                type="text"
                value={teamDraft.name}
                onChange={(e) => {
                  setTeamDraft({
                    name: e.target.value,
                    slug: slugify(e.target.value),
                  });
                }}
                placeholder="Team name, e.g. Backend"
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddTeam}
                disabled={!teamDraft.name.trim() || busy}
                className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-40"
              >
                <PlusIcon className="h-4 w-4" />
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invites */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Invite members
        </h3>
        <div className="space-y-2">
          {wizard.invites.map((inv, idx) => (
            <div
              key={`${inv.email}-${idx}`}
              className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-2">
                <EnvelopeIcon className="h-4 w-4 text-slate-500" />
                <span className="text-slate-100">{inv.email}</span>
                <span className="text-xs text-slate-500">· {inv.role}</span>
              </div>
              <div className="flex items-center gap-2">
                {inv.inviteUrl && (
                  <button
                    onClick={() => copyInvite(inv.inviteUrl!, idx)}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                  >
                    {copiedIdx === idx ? (
                      <>
                        <CheckIcon className="h-3.5 w-3.5" />
                        Copied
                      </>
                    ) : (
                      <>
                        <ClipboardIcon className="h-3.5 w-3.5" />
                        Copy link
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={() => dispatch(onboardingActions.removeInvite(idx))}
                  className="text-slate-500 hover:text-red-400"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              value={inviteDraft.email}
              onChange={(e) => setInviteDraft({ ...inviteDraft, email: e.target.value })}
              placeholder="teammate@example.com"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none"
            />
            <select
              value={inviteDraft.role}
              onChange={(e) =>
                setInviteDraft({
                  ...inviteDraft,
                  role: e.target.value as Role,
                })
              }
              className="rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 focus:border-emerald-500/60 focus:outline-none"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAddInvite}
              disabled={!inviteDraft.email.trim() || busy}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-40"
            >
              <PlusIcon className="h-4 w-4" />
              Invite
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Invites are generated as signed URLs you can share via email, Slack, or wherever. Each
          link expires in 14 days.
        </p>
      </div>

      <WizardError message={error} />
      <WizardNav onBack={onBack} onNext={onNext} busy={busy} />
    </WizardCard>
  );
}
