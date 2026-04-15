import { Box, Text } from "ink";
import * as path from "node:path";
import React, { memo } from "react";

import { ToolCallTitle } from "src/tools/ToolCallTitle.js";

import type { ChatHistoryItem } from "../../../../../core/index.js";
import { MarkdownRenderer } from "../MarkdownRenderer.js";
import { ToolResultSummary } from "../ToolResultSummary.js";

/**
 * Some providers (Groq Llama, certain Gemini variants) emit tool
 * calls as inline XML-ish text — `<ToolName>{"file_path":"..."}</function>`
 * — instead of as native tool_calls. The CLI never converted those
 * back to a proper tool card, so users saw the raw markup. This
 * regex peels the wrapper off and replaces it with a clean
 * `**ToolName**(./path)` line so MarkdownRenderer can show it as
 * bold-name + arg.
 *
 * Pattern:  <Word>{...optional JSON...}</function|word>
 */
const INLINE_TOOL_CALL_RE = /<(\w+)>\s*(\{[^<>]*\})?\s*<\/(?:function|\w+)>/g;

/**
 * Wrap a label in an OSC 8 hyperlink so iTerm2 / kitty / modern
 * Terminal.app / Windows Terminal render it as a clickable link.
 * Old terminals strip the escapes and show the raw label, so this
 * is safe to emit unconditionally.
 *
 *   ESC ] 8 ; ; URL ESC \ <label> ESC ] 8 ; ; ESC \
 */
function makeOsc8Link(label: string, url: string): string {
  const ESC = "\u001b";
  const ST = `${ESC}\\`;
  return `${ESC}]8;;${url}${ST}${label}${ESC}]8;;${ST}`;
}

/**
 * Heuristic: looks like a workspace-relative or absolute path.
 * Matches `./foo`, `../foo`, `/abs/foo`, `foo/bar.ext`, `foo.ext`.
 */
function looksLikePath(value: string): boolean {
  if (!value || value.length > 1024) return false;
  if (value.startsWith("./") || value.startsWith("../")) return true;
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return true;
  // Bare filename with extension or any path separator
  return /[\\/]/.test(value) || /\.[A-Za-z0-9]{1,8}$/.test(value);
}

/**
 * Resolve to an absolute file:// URL using process.cwd() for relative
 * paths so terminals can open it. Returns the original label when it
 * doesn't look like a real path.
 */
function pathLink(value: string): string {
  if (!looksLikePath(value)) return value;
  try {
    const abs = path.isAbsolute(value)
      ? value
      : path.resolve(process.cwd(), value);
    return makeOsc8Link(value, `file://${abs}`);
  } catch {
    return value;
  }
}

function cleanInlineToolCalls(text: string): string {
  return text.replace(INLINE_TOOL_CALL_RE, (_match, toolName, jsonBlob) => {
    if (!jsonBlob) return `**${toolName}**`;
    let firstArg = "";
    try {
      const parsed = JSON.parse(jsonBlob);
      // Prefer keys that look like a path; fall back to first value.
      const pathKey = Object.keys(parsed).find((k) =>
        k.toLowerCase().includes("path"),
      );
      const value = pathKey ? parsed[pathKey] : Object.values(parsed)[0];
      firstArg =
        typeof value === "string"
          ? pathLink(value)
          : value !== undefined
            ? JSON.stringify(value)
            : "";
    } catch {
      // Malformed JSON — keep the raw blob trimmed
      firstArg = jsonBlob.replace(/[{}"]/g, "").trim();
    }
    return firstArg ? `**${toolName}**(${firstArg})` : `**${toolName}**`;
  });
}

/**
 * Formats message content for display, converting message parts array back to
 * user-friendly format with placeholders like [Image #1], [Pasted Text #1], etc.
 */
function formatMessageContentForDisplay(
  content: import("../../../../../core/index.js").MessageContent,
): string {
  if (typeof content === "string") {
    return cleanInlineToolCalls(content);
  }

  if (!Array.isArray(content)) {
    return JSON.stringify(content);
  }

  // Convert message parts array back to display format with placeholders
  let displayText = "";
  let imageCounter = 0;

  for (const part of content) {
    if (part.type === "text") {
      displayText += part.text;
    } else if (part.type === "imageUrl") {
      imageCounter++;
      displayText += `[Image #${imageCounter}]`;
    } else {
      // Handle any other part types by converting to JSON
      displayText += JSON.stringify(part);
    }
  }

  return cleanInlineToolCalls(displayText);
}

interface MemoizedMessageProps {
  item: ChatHistoryItem;
  index: number;
  hideBullet?: boolean;
}

export const MemoizedMessage = memo<MemoizedMessageProps>(
  ({ item, index, hideBullet = false }) => {
    const { message, toolCallStates, conversationSummary } = item;
    const isUser = message.role === "user";
    const isSystem = message.role === "system";
    const isAssistant = message.role === "assistant";

    // Handle system messages
    if (isSystem) {
      return (
        <Box key={index} marginBottom={1}>
          <Text color="dim" italic>
            {message.content}
          </Text>
        </Box>
      );
    }

    // Handle conversation summary (compaction)
    if (conversationSummary) {
      return (
        <Box
          key={index}
          marginBottom={1}
          borderStyle="single"
          borderBottom={false}
          borderLeft={false}
          borderRight={false}
          borderColor="gray"
        />
      );
    }

    // Handle tool calls
    if (toolCallStates && toolCallStates.length > 0) {
      return (
        <Box key={index} flexDirection="column">
          {/* Render assistant message content if any */}
          {message.content && (
            <Box marginBottom={1}>
              <Text color="white">{hideBullet ? " " : "●"}</Text>
              <Text> </Text>
              <MarkdownRenderer
                content={formatMessageContentForDisplay(message.content)}
              />
            </Box>
          )}

          {/* Render tool calls */}
          {toolCallStates.map((toolState) => {
            const toolName = toolState.toolCall.function.name;
            const toolArgs = toolState.parsedArgs;
            const isCompleted = toolState.status === "done";
            const isErrored =
              toolState.status === "errored" || toolState.status === "canceled";

            return (
              <Box
                key={toolState.toolCallId}
                flexDirection="column"
                marginBottom={1}
              >
                <Box width="100%">
                  <Box flexShrink={0}>
                    <Text
                      color={
                        isErrored
                          ? "red"
                          : isCompleted
                            ? "green"
                            : toolState.status === "generated"
                              ? "yellow"
                              : "white"
                      }
                    >
                      {isCompleted || isErrored ? "●" : "○"}
                    </Text>
                  </Box>
                  <Box flexGrow={1} flexShrink={1} minWidth={0}>
                    <Text color="white">
                      {" "}
                      <ToolCallTitle toolName={toolName} args={toolArgs} />
                    </Text>
                  </Box>
                </Box>

                {isErrored ? (
                  <Box marginLeft={2}>
                    <Text color="red">
                      {toolState.output?.[0].content ?? "Tool execution failed"}
                    </Text>
                  </Box>
                ) : (
                  toolState.output &&
                  toolState.output.length > 0 && (
                    <Box marginLeft={2}>
                      <ToolResultSummary
                        toolName={toolName}
                        content={toolState.output
                          .map((o) => o.content)
                          .join("\n")}
                      />
                    </Box>
                  )
                )}
              </Box>
            );
          })}
        </Box>
      );
    }

    // Handle regular messages
    const isStreaming = isAssistant && !message.content && !toolCallStates;

    return (
      <Box key={index} marginBottom={1}>
        <Text color={isUser ? "blue" : "white"}>{hideBullet ? " " : "●"}</Text>
        <Text> </Text>
        {isUser ? (
          <Text color="dim">
            {formatMessageContentForDisplay(message.content)}
          </Text>
        ) : (
          <MarkdownRenderer
            content={formatMessageContentForDisplay(message.content)}
          />
        )}
        {isStreaming && <Text color="dim">▋</Text>}
      </Box>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison function for better performance
    // Only re-render if these properties change
    const prevMessage = prevProps.item.message;
    const nextMessage = nextProps.item.message;
    const prevToolStates = prevProps.item.toolCallStates;
    const nextToolStates = nextProps.item.toolCallStates;

    return (
      prevMessage.content === nextMessage.content &&
      prevMessage.role === nextMessage.role &&
      JSON.stringify(prevToolStates) === JSON.stringify(nextToolStates) &&
      prevProps.item.conversationSummary ===
        nextProps.item.conversationSummary &&
      prevProps.index === nextProps.index &&
      prevProps.hideBullet === nextProps.hideBullet
    );
  },
);

MemoizedMessage.displayName = "MemoizedMessage";
