import { getAltKeyLabel, getMetaKeyLabel, isJetBrains } from "../../../../util";
import { GeneratingIndicator } from "./GeneratingIndicator";

interface StreamingToolbarProps {
  onStop: () => void;
  displayText?: string;
}

export function StreamingToolbar({
  onStop,
  displayText = "Stop",
}: StreamingToolbarProps) {
  const jetbrains = isJetBrains();

  return (
    <div className="flex w-full items-center justify-between">
      <GeneratingIndicator />
      <button
        onClick={onStop}
        className="flex items-center gap-1 rounded-md border border-error/30 bg-error/10 px-2 py-0.5 text-xs text-error transition-colors hover:bg-error/15 hover:text-error"
      >
        <span className="text-sm">{"\u23F9"}</span>
        <span>{displayText}</span>
        <span className="text-[10px] opacity-60">
          {jetbrains ? getAltKeyLabel() : getMetaKeyLabel()}{"\u232B"}
        </span>
      </button>
    </div>
  );
}
