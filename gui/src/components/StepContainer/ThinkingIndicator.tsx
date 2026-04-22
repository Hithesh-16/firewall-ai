import { ChatHistoryItem } from "core";
import { useAppSelector } from "../../redux/hooks";
import { AfTextShimmer } from "../loaders/AfTextShimmer";

interface ThinkingIndicatorProps {
  historyItem: ChatHistoryItem;
}

/**
 * Renders a subtle shimmer in the assistant bubble while the LLM has
 * accepted the request but hasn't streamed any tokens yet.
 *
 * The shimmer replaces the old model-specific "Thinking..." dots
 * (which only fired on o1). We now show it for *any* model whenever
 * the assistant turn is `isStreaming && !hasContent`, because the
 * first-token latency is the highest-friction moment in the UX —
 * without a visible signal the user assumes the request hung.
 *
 * Once a single token arrives the bubble's markdown preview takes
 * over and this component unmounts itself via the `hasContent` gate.
 * While the context-gathering phase is running we defer to
 * `ContextBar` / firewall scan UI — showing both would be noise.
 */
const ThinkingIndicator = ({ historyItem }: ThinkingIndicatorProps) => {
  const isStreaming = useAppSelector((state) => state.session.isStreaming);

  const hasContent = Array.isArray(historyItem.message.content)
    ? !!historyItem.message.content.length
    : !!historyItem.message.content;

  const isThinking =
    isStreaming && !historyItem.isGatheringContext && !hasContent;
  if (!isThinking) return null;

  return (
    <div className="px-2 py-2">
      <AfTextShimmer variant="thinking" />
    </div>
  );
};

export default ThinkingIndicator;
