import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  setPermissionMode,
  type PermissionMode,
} from "../../redux/slices/uiSlice";

const MODES: Array<{
  id: PermissionMode;
  label: string;
  description: string;
  color: string;
  activeColor: string;
}> = [
  {
    id: "off",
    label: "Off",
    description: "Ask for every tool",
    color: "text-warning",
    activeColor: "bg-warning/15 text-warning border-warning/40",
  },
  {
    id: "auto",
    label: "Auto",
    description: "Follow tool policies",
    color: "text-success",
    activeColor: "bg-success/15 text-success border-success/40",
  },
  {
    id: "turbo",
    label: "Turbo",
    description: "Skip low-risk approvals",
    color: "text-info",
    activeColor: "bg-info/15 text-info border-info/40",
  },
];

export function PermissionModeSelector() {
  const dispatch = useAppDispatch();
  const currentMode = useAppSelector((s) => s.ui.permissionMode);

  return (
    <div className="flex items-center gap-1">
      {MODES.map((mode) => {
        const isActive = currentMode === mode.id;
        return (
          <button
            key={mode.id}
            onClick={() => dispatch(setPermissionMode(mode.id))}
            title={mode.description}
            className={`px-2 py-1 text-xs font-medium rounded-md border transition-all
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus
              ${
                isActive
                  ? mode.activeColor
                  : "border-transparent text-description hover:text-foreground hover:bg-list-hover"
              }`}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
