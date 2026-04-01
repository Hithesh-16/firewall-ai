/**
 * Consistent error display with optional retry.
 */

interface ErrorBannerProps {
  message: string;
  detail?: string;
  onRetry?: () => void;
}

export default function ErrorBanner({ message, detail, onRetry }: ErrorBannerProps) {
  return (
    <div className="rounded-md border border-error/30 bg-error/5 px-4 py-3">
      <div className="flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-error">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="text-xs font-medium text-error">{message}</span>
      </div>
      {detail && (
        <p className="mt-1 text-2xs text-description pl-6">{detail}</p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 ml-6 text-2xs text-foreground underline hover:no-underline"
        >
          Retry
        </button>
      )}
    </div>
  );
}
