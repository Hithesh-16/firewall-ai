import React from "react";
import { ArrowLeftIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";

/**
 * Shared building blocks for the onboarding wizard. Keeps each step file
 * focused on its own form fields instead of repeating layout code.
 */

export function WizardCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative rounded-2xl border border-slate-800/80 bg-slate-900/60 p-7 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-md">
      <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      <div className="mt-6">{children}</div>
    </div>
  );
}

export function WizardError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
      {message}
    </div>
  );
}

export function WizardNav({
  onBack,
  onNext,
  nextLabel = "Continue",
  nextDisabled = false,
  busy = false,
  hideBack = false,
}: {
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
  hideBack?: boolean;
}) {
  return (
    <div className="mt-8 flex items-center justify-between gap-3">
      {hideBack ? (
        <span />
      ) : (
        <button
          type="button"
          onClick={onBack}
          disabled={busy || !onBack}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back
        </button>
      )}

      <button
        type="button"
        onClick={onNext}
        disabled={busy || nextDisabled}
        className={cn(
          "inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold text-white transition-all",
          "bg-gradient-to-r from-emerald-500 to-cyan-500",
          "shadow-[0_0_25px_rgba(16,185,129,0.35)]",
          "hover:scale-[1.03] hover:shadow-[0_0_35px_rgba(16,185,129,0.5)]",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100",
        )}
      >
        {busy ? (
          <>
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Saving…
          </>
        ) : (
          <>
            {nextLabel}
            <ArrowRightIcon className="h-4 w-4" />
          </>
        )}
      </button>
    </div>
  );
}

/**
 * Slugify helper used by Steps 1, 2, 3 to keep slugs URL-safe.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

/**
 * Generate a short random localId for list rendering before items hit
 * the server. (Crypto.randomUUID would work too but is overkill.)
 */
export function tinyId(): string {
  return Math.random().toString(36).slice(2, 10);
}
