import type { AgentSession } from "../../redux/slices/agentSlice";
import { removeAgent } from "../../redux/slices/agentSlice";
import { useAppDispatch } from "../../redux/hooks";

const STATUS_COLORS: Record<AgentSession["status"], string> = {
  running: "bg-success/20 text-success",
  completed: "bg-info/20 text-info",
  failed: "bg-error/20 text-error",
  cancelled: "bg-description-muted/20 text-description-muted",
};

export function ActiveAgentCard({ agent }: { agent: AgentSession }) {
  const dispatch = useAppDispatch();
  const elapsed = Math.round((Date.now() - agent.startedAt) / 1000);

  return (
    <div className="rounded-lg border border-border bg-editor px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[agent.status]}`}
        >
          {agent.status}
        </span>
        <span className="text-xs text-description font-mono">{agent.model}</span>
        <span className="text-xs text-description ml-auto">{elapsed}s</span>
      </div>

      <p className="text-sm text-foreground mb-2 line-clamp-2">{agent.task}</p>

      {/* Progress bar */}
      {agent.status === "running" && (
        <div className="h-1 bg-secondary-background rounded-full overflow-hidden mb-2">
          <div
            className="h-full bg-success transition-all duration-500"
            style={{ width: `${agent.progress}%` }}
          />
        </div>
      )}

      {agent.status === "running" && (
        <button
          onClick={() => dispatch(removeAgent(agent.id))}
          className="text-xs text-error hover:underline"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
