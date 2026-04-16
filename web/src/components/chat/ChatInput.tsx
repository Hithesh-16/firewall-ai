import { useRef, useCallback, type KeyboardEvent } from "react";
import { ArrowUpIcon, PaperClipIcon } from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  addMessage,
  updateMessage,
  setStreaming,
  setInputText,
  createConversation,
} from "../../store/slices/chatSlice";
import { selectActiveConversation } from "../../store/slices/chatSlice";
import { ModelPicker } from "./ModelPicker";
import { QuickActionChips } from "./QuickActionChips";
import { getToken } from "../../utils/storage";
import { store } from "../../store";
import { ENDPOINTS } from "../../api/endpoints";

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface ChatInputProps {
  className?: string;
}

export function ChatInput({ className }: ChatInputProps) {
  const dispatch = useAppDispatch();
  const inputText = useAppSelector((s) => s.chat.inputText);
  const selectedModel = useAppSelector((s) => s.chat.selectedModel);
  const streaming = useAppSelector((s) => s.chat.streaming);
  const conversation = useAppSelector(selectActiveConversation);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isEmpty = !conversation || conversation.messages.length === 0;

  function resizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;

      // Ensure we have a conversation
      let convId: string | undefined = conversation?.id;
      if (!convId) {
        dispatch(createConversation());
        // We need to read the new conversation ID from the store after dispatch
        // Use a short timeout to let redux update
        await new Promise((r) => setTimeout(r, 0));
      }

      // Get the conversation ID after potential creation
      const currentState = store.getState();
      convId = currentState.chat.activeConversationId ?? undefined;
      if (!convId) return;

      const activeConv = currentState.chat.conversations.find((c) => c.id === convId);

      // Add user message
      const userMsg = {
        id: generateId(),
        role: "user" as const,
        content: trimmed,
        timestamp: Date.now(),
      };
      dispatch(addMessage({ convId, message: userMsg }));
      dispatch(setInputText(""));

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      // Create assistant message placeholder
      const assistantMsgId = generateId();
      const assistantMsg = {
        id: assistantMsgId,
        role: "assistant" as const,
        content: "",
        timestamp: Date.now(),
        streaming: true,
      };
      dispatch(addMessage({ convId, message: assistantMsg }));
      dispatch(setStreaming(true));

      // Build messages array for the API
      const history = activeConv?.messages ?? [];
      const apiMessages = [
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: trimmed },
      ];

      try {
        const token = getToken();
        const response = await fetch(ENDPOINTS.chat.completions, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            model: selectedModel,
            messages: apiMessages,
            stream: true,
          }),
        });

        if (!response.ok) {
          let errorText = `${response.status} ${response.statusText}`;
          try {
            const errBody = await response.json();
            if (errBody.error) errorText = errBody.error;
          } catch {
            // ignore parse errors
          }
          throw new Error(errorText);
        }

        // Parse X-AF headers for scan results
        const afAction = response.headers.get("X-AF-Action");
        const afRiskScore = response.headers.get("X-AF-Risk-Score");
        const afSecretsCount = response.headers.get("X-AF-Secrets-Count");
        const afPiiCount = response.headers.get("X-AF-PII-Count");
        const afInputTokens = response.headers.get("X-AF-Input-Tokens");
        const afCost = response.headers.get("X-AF-Estimated-Cost");

        // Read SSE stream
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let fullContent = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          // Keep the last potentially incomplete line in the buffer
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || !trimmedLine.startsWith("data: ")) continue;

            const data = trimmedLine.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                dispatch(
                  updateMessage({
                    convId: convId!,
                    msgId: assistantMsgId,
                    partial: { content: fullContent },
                  }),
                );
              }
            } catch {
              // skip malformed JSON chunks
            }
          }
        }

        // Finalize the message
        const scanResult = afAction
          ? {
              action: afAction,
              riskScore: Number(afRiskScore ?? 0),
              secretsFound: Number(afSecretsCount ?? 0),
              piiFound: Number(afPiiCount ?? 0),
            }
          : undefined;

        const cost =
          afCost || afInputTokens
            ? {
                inputTokens: Number(afInputTokens ?? 0),
                outputTokens: 0,
                estimatedCost: Number(afCost ?? 0),
              }
            : undefined;

        dispatch(
          updateMessage({
            convId: convId!,
            msgId: assistantMsgId,
            partial: {
              content: fullContent,
              streaming: false,
              scanResult,
              cost,
            },
          }),
        );
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : "Failed to get response";
        dispatch(
          updateMessage({
            convId: convId!,
            msgId: assistantMsgId,
            partial: {
              content: `Error: ${errorMessage}`,
              streaming: false,
            },
          }),
        );
      } finally {
        dispatch(setStreaming(false));
      }
    },
    [conversation, selectedModel, streaming, dispatch],
  );

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(inputText);
    }
  }

  function handleQuickAction(prompt: string) {
    dispatch(setInputText(prompt));
    void sendMessage(prompt);
  }

  return (
    <div className={cn("border-border bg-background border-t px-4 pb-4 pt-3", className)}>
      {/* Quick action chips when conversation is empty */}
      {isEmpty && <QuickActionChips onSelect={handleQuickAction} className="mb-4" />}

      {/* Model picker row */}
      <div className="mb-2 flex items-center">
        <ModelPicker />
      </div>

      {/* Input area */}
      <div className="border-border bg-editor focus-within:border-border-focus flex items-end gap-2 rounded-xl border p-2">
        {/* Attachment button */}
        <button
          type="button"
          className="text-description hover:bg-list-hover hover:text-foreground mb-0.5 rounded-lg p-1.5"
          aria-label="Attach file"
        >
          <PaperClipIcon className="h-5 w-5" />
        </button>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={inputText}
          onChange={(e) => {
            dispatch(setInputText(e.target.value));
            resizeTextarea();
          }}
          onKeyDown={handleKeyDown}
          placeholder="Message AI Firewall..."
          rows={1}
          disabled={streaming}
          className="text-foreground placeholder:text-input-placeholder max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent text-sm focus:outline-none disabled:opacity-50"
        />

        {/* Send button */}
        <button
          type="button"
          onClick={() => void sendMessage(inputText)}
          disabled={!inputText.trim() || streaming}
          className={cn(
            "mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors",
            inputText.trim() && !streaming
              ? "bg-primary text-primary-foreground hover:bg-primary-hover"
              : "bg-secondary text-description-muted",
          )}
          aria-label="Send message"
        >
          <ArrowUpIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Disclaimer */}
      <p className="text-description-muted mt-2 text-center text-[11px]">
        All messages are scanned by AI Firewall before being sent to the provider.
      </p>
    </div>
  );
}
