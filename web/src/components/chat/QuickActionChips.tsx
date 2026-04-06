import {
  ShieldExclamationIcon,
  CodeBracketIcon,
  AcademicCapIcon,
  BugAntIcon,
} from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";

interface QuickAction {
  label: string;
  prompt: string;
  icon: React.ComponentType<{ className?: string }>;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: "Security Audit",
    prompt: "Run a security audit on my codebase and identify vulnerabilities",
    icon: ShieldExclamationIcon,
  },
  {
    label: "Code Review",
    prompt: "Review the current file for code quality, bugs, and improvements",
    icon: CodeBracketIcon,
  },
  {
    label: "Explain Code",
    prompt: "Explain how this code works in detail",
    icon: AcademicCapIcon,
  },
  {
    label: "Find Vulnerabilities",
    prompt: "Scan for security vulnerabilities, secrets, and PII in this code",
    icon: BugAntIcon,
  },
];

interface QuickActionChipsProps {
  onSelect: (prompt: string) => void;
  className?: string;
}

export function QuickActionChips({
  onSelect,
  className,
}: QuickActionChipsProps) {
  return (
    <div className={cn("flex flex-wrap justify-center gap-2", className)}>
      {QUICK_ACTIONS.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.label}
            type="button"
            onClick={() => onSelect(action.prompt)}
            className="border-border bg-editor text-foreground hover:border-primary/40 hover:bg-primary/5 flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors"
          >
            <Icon className="text-primary h-4 w-4" />
            <span>{action.label}</span>
          </button>
        );
      })}
    </div>
  );
}
