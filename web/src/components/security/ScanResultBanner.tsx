import {
  CheckCircleIcon,
  PencilSquareIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";

interface ScanResultBannerProps {
  action: string;
  riskScore: number;
  details?: string;
}

const configMap: Record<
  string,
  { bg: string; icon: React.ReactNode; label: string }
> = {
  ALLOW: {
    bg: "bg-success/10 border-success/30 text-success",
    icon: <CheckCircleIcon className="h-5 w-5" />,
    label: "Allowed",
  },
  REDACT: {
    bg: "bg-warning/10 border-warning/30 text-warning",
    icon: <PencilSquareIcon className="h-5 w-5" />,
    label: "Redacted",
  },
  BLOCK: {
    bg: "bg-error/10 border-error/30 text-error",
    icon: <XCircleIcon className="h-5 w-5" />,
    label: "Blocked",
  },
};

export function ScanResultBanner({
  action,
  riskScore,
  details,
}: ScanResultBannerProps) {
  const config = configMap[action] ?? configMap.ALLOW;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border px-4 py-2 text-sm",
        config.bg,
      )}
    >
      {config.icon}
      <span className="font-medium">{config.label}</span>
      {details && (
        <span className="text-xs opacity-80">
          {"\u2014"} {details}
        </span>
      )}
      <span className="ml-auto font-mono text-xs opacity-70">
        Risk: {riskScore}
      </span>
    </div>
  );
}
