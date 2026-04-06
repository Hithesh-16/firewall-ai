import { Switch } from "@headlessui/react";
import { cn } from "../../utils/cn";

interface ToggleProps {
  enabled: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  className?: string;
}

export function Toggle({ enabled, onChange, label, className }: ToggleProps) {
  return (
    <Switch.Group>
      <div className={cn("flex items-center gap-2", className)}>
        <Switch
          checked={enabled}
          onChange={onChange}
          className={cn(
            "focus:ring-primary/50 focus:ring-offset-background relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2",
            enabled ? "bg-primary" : "bg-secondary",
          )}
        >
          <span
            className={cn(
              "bg-primary-foreground pointer-events-none inline-block h-4 w-4 rounded-full shadow-sm transition-transform duration-200",
              enabled ? "translate-x-4" : "translate-x-0",
            )}
          />
        </Switch>
        {label && (
          <Switch.Label className="text-foreground cursor-pointer text-sm">
            {label}
          </Switch.Label>
        )}
      </div>
    </Switch.Group>
  );
}
