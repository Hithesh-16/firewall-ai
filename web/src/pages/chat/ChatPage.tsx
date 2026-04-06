import { useState, useEffect } from "react";
import {
  ShieldCheckIcon,
  SignalIcon,
  SignalSlashIcon,
} from "@heroicons/react/24/outline";
import { useAppSelector } from "../../store/hooks";
import { selectActiveMessages } from "../../store/slices/chatSlice";
import { ChatMessageList } from "../../components/chat/ChatMessageList";
import { ChatInput } from "../../components/chat/ChatInput";
import { ArtifactPanel } from "../../components/chat/ArtifactPanel";
import { apiClient } from "../../api/client";
import { Badge } from "../../components/ui/Badge";
import { formatCost } from "../../utils/format";

interface HealthStatus {
  connected: boolean;
  version?: string;
}

interface SessionStats {
  scanned: number;
  blocked: number;
  totalCost: number;
}

function SecurityStatusBar() {
  const [health, setHealth] = useState<HealthStatus>({ connected: false });
  const [stats, setStats] = useState<SessionStats>({
    scanned: 0,
    blocked: 0,
    totalCost: 0,
  });

  useEffect(() => {
    let cancelled = false;

    async function checkHealth() {
      try {
        const data = await apiClient.get<{ status: string; version?: string }>(
          "/health",
        );
        if (!cancelled) {
          setHealth({ connected: data.status === "ok", version: data.version });
        }
      } catch {
        if (!cancelled) setHealth({ connected: false });
      }
    }

    async function fetchStats() {
      try {
        const data = await apiClient.get<{
          totalRequests?: number;
          blockedRequests?: number;
          totalCost?: number;
        }>("/api/stats");
        if (!cancelled) {
          setStats({
            scanned: data.totalRequests ?? 0,
            blocked: data.blockedRequests ?? 0,
            totalCost: data.totalCost ?? 0,
          });
        }
      } catch {
        // stats endpoint may not exist yet
      }
    }

    void checkHealth();
    void fetchStats();

    const interval = setInterval(() => {
      void checkHealth();
      void fetchStats();
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="border-border bg-editor flex items-center gap-4 border-b px-4 py-2">
      {/* Proxy health */}
      <div className="flex items-center gap-1.5">
        {health.connected ? (
          <SignalIcon className="text-success h-4 w-4" />
        ) : (
          <SignalSlashIcon className="text-error h-4 w-4" />
        )}
        <span className="text-description text-xs">
          Proxy {health.connected ? "connected" : "offline"}
        </span>
      </div>

      <div className="bg-border h-3 w-px" />

      {/* Session stats */}
      <div className="text-description-muted flex items-center gap-3 text-xs">
        <span className="flex items-center gap-1">
          <ShieldCheckIcon className="h-3.5 w-3.5" />
          {stats.scanned} scanned
        </span>
        {stats.blocked > 0 && (
          <Badge variant="error">{stats.blocked} blocked</Badge>
        )}
        {stats.totalCost > 0 && (
          <span>{formatCost(stats.totalCost)} spent</span>
        )}
      </div>
    </div>
  );
}

export function ChatPage() {
  const messages = useAppSelector(selectActiveMessages);
  const artifactOpen = useAppSelector((s) => s.chat.artifactPanelOpen);

  return (
    <div className="flex h-full flex-col">
      {/* Security status bar */}
      <SecurityStatusBar />

      {/* Main content area */}
      <div className="flex min-h-0 flex-1">
        {/* Chat column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Messages */}
          <ChatMessageList messages={messages} />

          {/* Input */}
          <ChatInput />
        </div>

        {/* Artifact panel */}
        {artifactOpen && <ArtifactPanel />}
      </div>
    </div>
  );
}
