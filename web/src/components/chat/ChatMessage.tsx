import { ShieldCheckIcon } from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";
import { SecurityIndicator } from "./SecurityIndicator";
import { CostBadge } from "./CostBadge";
import { StreamingResponse } from "./StreamingResponse";
import type { ChatMessage as ChatMessageType } from "../../store/slices/chatSlice";

interface ChatMessageProps {
  message: ChatMessageType;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function UserAvatar({ name }: { name: string }) {
  const initial = (name || "U").charAt(0).toUpperCase();
  return (
    <div className="bg-info text-primary-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium">
      {initial}
    </div>
  );
}

function AssistantAvatar() {
  return (
    <div className="bg-primary/20 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
      <ShieldCheckIcon className="h-4.5 w-4.5 text-primary" />
    </div>
  );
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isStreaming = message.streaming === true;

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-3",
        isUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      {/* Avatar */}
      {isUser ? <UserAvatar name="U" /> : <AssistantAvatar />}

      {/* Content bubble */}
      <div
        className={cn(
          "flex max-w-[75%] flex-col gap-1",
          isUser ? "items-end" : "items-start",
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-4 py-3",
            isUser
              ? "bg-primary/10 text-foreground"
              : "bg-editor text-foreground",
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {message.content}
            </p>
          ) : (
            <StreamingResponse
              content={message.content}
              streaming={isStreaming}
            />
          )}
        </div>

        {/* Meta row: timestamp, security, cost */}
        <div
          className={cn(
            "flex items-center gap-2 px-1",
            isUser ? "flex-row-reverse" : "flex-row",
          )}
        >
          <span className="text-description-muted text-[11px]">
            {formatTime(message.timestamp)}
          </span>

          {message.scanResult && (
            <SecurityIndicator
              action={message.scanResult.action}
              riskScore={message.scanResult.riskScore}
              secretsFound={message.scanResult.secretsFound}
              piiFound={message.scanResult.piiFound}
            />
          )}

          {message.cost && (
            <CostBadge
              estimatedCost={message.cost.estimatedCost}
              inputTokens={message.cost.inputTokens}
              outputTokens={message.cost.outputTokens}
            />
          )}
        </div>
      </div>
    </div>
  );
}
