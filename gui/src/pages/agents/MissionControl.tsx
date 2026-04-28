import { useCallback, useEffect, useRef, useState } from "react";
import { useAppSelector } from "../../redux/hooks";
import type { AgentSession } from "../../redux/slices/agentSlice";

/**
 * Mission Control — live grid of parallel agents with stream buffering.
 *
 * Uses requestAnimationFrame to batch high-throughput WebSocket events
 * into React state updates, preventing frame drops when 3 agents stream
 * simultaneously. Pattern from useActivePromptTracking.ts.
 */
export function MissionControl() {
  const agents = useAppSelector((s) => s.agent.activeAgents);
  const [streamBuffers, setStreamBuffers] = useState<Record<string, string>>(
    {},
  );
  const bufferRef = useRef<Record<string, string>>({});
  const rafRef = useRef<number | null>(null);

  // Flush buffered stream data to React state on animation frame
  const flushBuffers = useCallback(() => {
    setStreamBuffers({ ...bufferRef.current });
    rafRef.current = null;
  }, []);

  // Called by WebSocket or agent output handler
  const onAgentOutput = useCallback(
    (agentId: string, output: string) => {
      bufferRef.current[agentId] = output;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flushBuffers);
      }
    },
    [flushBuffers],
  );

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  if (agents.length === 0) {
    return (
      <div className="text-description py-8 text-center text-sm">
        No agents running. Use the spawn_agent tool to start parallel tasks.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {agents.map((agent) => (
        <AgentStreamCard
          key={agent.id}
          agent={agent}
          output={streamBuffers[agent.id] ?? ""}
        />
      ))}
    </div>
  );
}

function AgentStreamCard({
  agent,
  output,
}: {
  agent: AgentSession;
  output: string;
}) {
  const outputRef = useRef<HTMLPreElement>(null);

  // Auto-scroll to bottom on new output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  return (
    <div className="border-border bg-editor overflow-hidden rounded-lg border">
      {/* Header */}
      <div className="border-border flex items-center gap-2 border-b px-3 py-2">
        <div
          className={`h-2 w-2 rounded-full ${
            agent.status === "running"
              ? "bg-success animate-pulse"
              : agent.status === "failed"
                ? "bg-error"
                : "bg-description-muted"
          }`}
        />
        <span className="text-foreground flex-1 truncate text-xs font-medium">
          {agent.task.slice(0, 80)}
        </span>
        <span className="text-description font-mono text-xs">
          {agent.model}
        </span>
      </div>

      {/* Progress */}
      {agent.status === "running" && agent.progress > 0 && (
        <div className="bg-surface-inset h-0.5">
          <div
            className="bg-success h-full transition-all duration-300"
            style={{ width: `${agent.progress}%` }}
          />
        </div>
      )}

      {/* Output stream */}
      {output && (
        <pre
          ref={outputRef}
          className="text-description max-h-32 overflow-y-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs"
        >
          {output}
        </pre>
      )}
    </div>
  );
}
