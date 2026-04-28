import {
  MagnifyingGlassIcon,
  CloudArrowDownIcon,
  GlobeAltIcon,
} from "@heroicons/react/24/outline";
import { BuiltInToolNames } from "core/tools/builtIn";
import Spinner from "../../../components/gui/Spinner";

interface ToolProgressIconProps {
  functionName: string | undefined;
  status: string;
  defaultIcon: any;
}

export function ToolProgressIcon({
  functionName,
  status,
  defaultIcon: DefaultIcon,
}: ToolProgressIconProps) {
  const isRunning = status === "generating" || status === "calling";

  if (!isRunning) {
    return <DefaultIcon className="text-description h-4 w-4" />;
  }

  // Show specific icons for search/scrape
  if (
    functionName === BuiltInToolNames.SearchWeb ||
    functionName === BuiltInToolNames.ResearchWeb
  ) {
    return (
      <div className="relative flex items-center justify-center">
        <MagnifyingGlassIcon className="text-info absolute h-4 w-4 animate-ping opacity-20" />
        <MagnifyingGlassIcon className="text-info h-4 w-4" />
      </div>
    );
  }

  if (functionName === BuiltInToolNames.FetchUrlContent) {
    return (
      <div className="relative flex items-center justify-center">
        <CloudArrowDownIcon className="text-info absolute h-4 w-4 animate-bounce opacity-20" />
        <CloudArrowDownIcon className="text-info h-4 w-4" />
      </div>
    );
  }

  return <Spinner />;
}
