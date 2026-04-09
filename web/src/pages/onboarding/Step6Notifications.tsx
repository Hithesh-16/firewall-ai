import { useState } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { onboardingActions } from "../../store/slices/onboardingSlice";
import { apiClient } from "../../api/client";
import { WizardCard, WizardError, WizardNav } from "./_shared";

/**
 * Step 6 — Notifications & integrations.
 *
 * All channels are optional. The user can wire up webhooks, Slack, email
 * (if the proxy has SMTP), or Web Push for in-browser approval alerts.
 * Skipped entirely for individual workspaces.
 */

export function Step6Notifications({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack: () => void;
}) {
  const dispatch = useAppDispatch();
  const wizard = useAppSelector((s) => s.onboarding);

  const [webhookUrl, setWebhookUrl] = useState(
    wizard.notifications.webhookUrl || "",
  );
  const [slackUrl, setSlackUrl] = useState(
    wizard.notifications.slackWebhookUrl || "",
  );
  const [email, setEmail] = useState(wizard.notifications.email || "");
  const [webPush, setWebPush] = useState(
    wizard.notifications.webPushEnabled,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function persistChannel(
    channelType: "webhook" | "slack" | "email" | "webpush",
    config: Record<string, unknown>,
  ) {
    try {
      await apiClient.post("/api/notifications/channels", {
        channelType,
        config,
      });
    } catch (err) {
      // Best-effort — the proxy may not have SMTP configured, or the
      // endpoint may 404 on some deployments. Surface but don't block.
      console.warn(`[Step6] ${channelType} channel save failed:`, err);
    }
  }

  async function handleContinue() {
    setError(null);
    setBusy(true);
    try {
      if (webhookUrl.trim()) {
        await persistChannel("webhook", { url: webhookUrl.trim() });
      }
      if (slackUrl.trim()) {
        await persistChannel("slack", { webhookUrl: slackUrl.trim() });
      }
      if (email.trim()) {
        await persistChannel("email", { address: email.trim() });
      }
      if (webPush) {
        await persistChannel("webpush", { enabled: true });
      }

      dispatch(
        onboardingActions.setNotifications({
          webhookUrl: webhookUrl.trim() || undefined,
          slackWebhookUrl: slackUrl.trim() || undefined,
          email: email.trim() || undefined,
          webPushEnabled: webPush,
        }),
      );
      onNext();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to save channels",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <WizardCard
      title="Where should we send alerts?"
      subtitle="Approval requests, blocks, and security incidents get routed to these channels. All optional — skip and configure later if you prefer."
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-200">
            Generic webhook URL
          </label>
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://example.com/incoming"
            className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-200">
            Slack incoming webhook
          </label>
          <input
            type="url"
            value={slackUrl}
            onChange={(e) => setSlackUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-200">
            Email address <span className="text-slate-500">(requires SMTP)</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alerts@example.com"
            className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-3">
          <div>
            <p className="text-sm font-medium text-slate-100">
              Browser push notifications
            </p>
            <p className="text-xs text-slate-500">
              Get an OS-level alert when an approval is needed.
            </p>
          </div>
          <label className="relative inline-flex shrink-0 cursor-pointer items-center">
            <input
              type="checkbox"
              checked={webPush}
              onChange={(e) => setWebPush(e.target.checked)}
              className="peer sr-only"
            />
            <div className="peer h-5 w-9 rounded-full bg-slate-700 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-emerald-500 peer-checked:after:translate-x-full" />
          </label>
        </div>
      </div>

      <WizardError message={error} />
      <WizardNav onBack={onBack} onNext={handleContinue} busy={busy} />
    </WizardCard>
  );
}
