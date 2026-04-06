import {
  PlusIcon,
  ChatBubbleLeftIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  createConversation,
  setActiveConversation,
  deleteConversation,
} from "../../store/slices/chatSlice";
import { formatRelativeTime } from "../../utils/format";

export function SidebarConversations() {
  const dispatch = useAppDispatch();
  const conversations = useAppSelector((s) => s.chat.conversations);
  const activeId = useAppSelector((s) => s.chat.activeConversationId);

  function handleNewChat() {
    dispatch(createConversation());
  }

  function handleSelect(id: string) {
    dispatch(setActiveConversation(id));
  }

  function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    dispatch(deleteConversation(id));
  }

  return (
    <div className="flex flex-col">
      {/* New chat button */}
      <button
        type="button"
        onClick={handleNewChat}
        className="border-border text-foreground hover:bg-list-hover mx-3 mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors"
      >
        <PlusIcon className="h-4 w-4" />
        <span>New Chat</span>
      </button>

      {/* Conversation list */}
      <div className="thin-scrollbar flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <p className="text-description-muted px-4 py-3 text-xs">
            No conversations yet
          </p>
        ) : (
          <ul className="space-y-0.5 px-2">
            {conversations.map((conv) => {
              const isActive = conv.id === activeId;
              return (
                <li key={conv.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(conv.id)}
                    className={cn(
                      "group flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition-colors",
                      isActive
                        ? "bg-list-active text-list-active-foreground"
                        : "text-foreground hover:bg-list-hover",
                    )}
                  >
                    <ChatBubbleLeftIcon className="text-description-muted mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{conv.title}</p>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="text-description-muted text-[11px]">
                          {formatRelativeTime(new Date(conv.updatedAt))}
                        </span>
                        <span className="bg-secondary text-description-muted rounded px-1.5 py-0.5 text-[10px]">
                          {conv.model}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => handleDelete(e, conv.id)}
                      className="text-description-muted hover:text-error mt-0.5 shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label={`Delete conversation: ${conv.title}`}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
