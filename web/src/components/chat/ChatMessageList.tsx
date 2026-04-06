import { useEffect, useRef } from "react";
import { ChatBubbleLeftRightIcon } from "@heroicons/react/24/outline";
import { ChatMessage } from "./ChatMessage";
import type { ChatMessage as ChatMessageType } from "../../store/slices/chatSlice";

interface ChatMessageListProps {
  messages: ChatMessageType[];
}

function isSameDay(a: number, b: number): boolean {
  const dateA = new Date(a);
  const dateB = new Date(b);
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
}

function formatDateSeparator(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (isSameDay(timestamp, now.getTime())) return "Today";
  if (isSameDay(timestamp, yesterday.getTime())) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <div className="bg-primary/10 mb-4 flex h-16 w-16 items-center justify-center rounded-2xl">
        <ChatBubbleLeftRightIcon className="text-primary h-8 w-8" />
      </div>
      <h2 className="text-foreground text-lg font-medium">
        Start a conversation
      </h2>
      <p className="text-description mt-2 max-w-sm text-sm">
        Ask a question, request a code review, or start a security audit. All
        messages are scanned by the AI Firewall.
      </p>
    </div>
  );
}

export function ChatMessageList({ messages }: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Only auto-scroll if user is near the bottom (within 150px)
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      150;

    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [
    messages,
    messages.length > 0 ? messages[messages.length - 1]?.content : undefined,
  ]);

  if (messages.length === 0) {
    return <EmptyState />;
  }

  return (
    <div
      ref={containerRef}
      className="thin-scrollbar flex-1 overflow-y-auto px-2 py-4"
    >
      {messages.map((msg, index) => {
        const prev = index > 0 ? messages[index - 1] : null;
        const showDateSep = !prev || !isSameDay(prev.timestamp, msg.timestamp);

        return (
          <div key={msg.id}>
            {showDateSep && (
              <div className="my-4 flex items-center justify-center">
                <div className="bg-secondary text-description-muted rounded-full px-3 py-1 text-xs">
                  {formatDateSeparator(msg.timestamp)}
                </div>
              </div>
            )}
            <ChatMessage message={msg} />
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
