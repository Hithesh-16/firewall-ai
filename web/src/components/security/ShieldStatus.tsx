import {
  ShieldCheckIcon,
  ShieldExclamationIcon,
} from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";

interface ShieldStatusProps {
  healthy: boolean;
}

export function ShieldStatus({ healthy }: ShieldStatusProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        {healthy ? (
          <ShieldCheckIcon className="text-success h-10 w-10" />
        ) : (
          <ShieldExclamationIcon className="text-error h-10 w-10" />
        )}
        {healthy && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
            <span className="bg-success absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" />
            <span className="bg-success relative inline-flex h-3 w-3 rounded-full" />
          </span>
        )}
      </div>
      <div>
        <p
          className={cn(
            "text-sm font-semibold",
            healthy ? "text-success" : "text-error",
          )}
        >
          {healthy ? "Protected" : "Offline"}
        </p>
        <p className="text-description text-xs">
          {healthy
            ? "Proxy is scanning all requests"
            : "Security proxy is unreachable"}
        </p>
      </div>
    </div>
  );
}
