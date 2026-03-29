import { CommandLineIcon } from "@heroicons/react/24/outline";
import { useContext } from "react";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { extractCommand } from "../utils/commandExtractor";

interface RunInTerminalButtonProps {
  command: string;
}

export function RunInTerminalButton({ command }: RunInTerminalButtonProps) {
  const ideMessenger = useContext(IdeMessengerContext);

  function runInTerminal() {
    // Extract just the command line
    const extractedCommand = extractCommand(command);
    void ideMessenger.post("runCommand", { command: extractedCommand });
  }

  return (
    <div
      className="text-description-muted flex items-center border-none bg-transparent text-xs cursor-pointer outline-none hover:brightness-125"
      onClick={runInTerminal}
    >
      <div
        className="max-2xs:hidden flex items-center gap-1 text-description-muted transition-colors duration-200 hover:brightness-125"
      >
        <>
          <CommandLineIcon className="h-3 w-3 hover:brightness-125" />
          <span className="text-description-muted max-sm:hidden">Run</span>
        </>
      </div>
    </div>
  );
}
