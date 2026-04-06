import {
  ExclamationTriangleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";

interface ErrorBannerProps {
  message: string;
  onDismiss?: () => void;
  className?: string;
}

export function ErrorBanner({
  message,
  onDismiss,
  className,
}: ErrorBannerProps) {
  return (
    <div
      className={cn(
        "border-error/30 bg-error/10 text-error flex items-center gap-3 rounded-md border px-4 py-3 text-sm",
        className,
      )}
      role="alert"
    >
      <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
      <p className="flex-1">{message}</p>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="hover:bg-error/20 shrink-0 rounded p-0.5"
          aria-label="Dismiss error"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
