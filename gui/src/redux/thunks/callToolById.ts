import { createAsyncThunk, unwrapResult } from "@reduxjs/toolkit";
import { ContextItem, McpUiState } from "core";
import { CLIENT_TOOLS_IMPLS } from "core/tools/builtIn";
import { ContinueError, ContinueErrorReason } from "core/util/errors";
import posthog from "posthog-js";
import { callClientTool } from "../../util/clientTools/callClientTool";
import { selectSelectedChatModel } from "../slices/configSlice";
import {
  acceptToolCall,
  errorToolCall,
  setInactive,
  setToolCallCalling,
  updateToolCallOutput,
} from "../slices/sessionSlice";
import { setTodos, type TodoItem } from "../slices/todosSlice";
import { ThunkApiType } from "../store";
import { findToolCallById, logToolUsage } from "../util";
import { streamResponseAfterToolCall } from "./streamResponseAfterToolCall";

export const callToolById = createAsyncThunk<
  void,
  { toolCallId: string; isAutoApproved?: boolean; depth?: number },
  ThunkApiType
>("chat/callTool", async (inputs, { dispatch, extra, getState }) => {
  const { toolCallId, isAutoApproved, depth = 0 } = inputs;

  const state = getState();
  const toolCallState = findToolCallById(state.session.history, toolCallId);
  if (!toolCallState) {
    console.warn(`Tool call with ID ${toolCallId} not found`);
    return;
  }

  if (toolCallState.status !== "generated") {
    return;
  }

  // Track tool call acceptance and start timing
  const startTime = Date.now();

  const selectedChatModel = selectSelectedChatModel(state);

  posthog.capture("tool_call_decision", {
    model: selectedChatModel,
    decision: isAutoApproved ? "auto_accept" : "accept",
    toolName: toolCallState.toolCall.function.name,
    toolCallId: toolCallId,
  });

  if (!selectedChatModel) {
    throw new Error("No model selected");
  }

  dispatch(
    setToolCallCalling({
      toolCallId,
    }),
  );

  let output: ContextItem[] | undefined = undefined;
  let mcpUiState: McpUiState | undefined = undefined;
  let error: ContinueError | undefined = undefined;
  let streamResponse: boolean;

  // IMPORTANT:
  // Errors that occur while calling tool call implementations
  // Are caught and passed in output as context items
  // Errors that occur outside specifically calling the tool
  // Should not be caught here - should be handled as normal stream errors
  if (
    CLIENT_TOOLS_IMPLS.find(
      (toolName) => toolName === toolCallState.toolCall.function.name,
    )
  ) {
    // Tool is called on client side
    const {
      output: clientToolOutput,
      respondImmediately,
      error: clientToolError,
    } = await callClientTool(toolCallState, {
      dispatch,
      ideMessenger: extra.ideMessenger,
      getState,
    });
    output = clientToolOutput;
    error = clientToolError;
    streamResponse = respondImmediately;
  } else {
    // Tool is called on core side
    const result = await extra.ideMessenger.request("tools/call", {
      toolCall: toolCallState.toolCall,
    });
    if (result.status === "error") {
      throw new Error(result.error);
    } else {
      output = result.content.contextItems;
      mcpUiState = result.content.mcpUiState;
      error = result.content.errorMessage
        ? new ContinueError(
            result.content.errorReason || ContinueErrorReason.Unspecified,
            result.content.errorMessage,
          )
        : undefined;
    }
    streamResponse = true;
  }

  if (error) {
    dispatch(
      updateToolCallOutput({
        toolCallId,
        contextItems: [
          {
            icon: "problems",
            name: "Tool Call Error",
            description: "Tool Call Failed",
            content: `${toolCallState.toolCall.function.name} failed with the message: ${error.message}\n\nPlease try something else or request further instructions.`,
            hidden: false,
          },
        ],
      }),
    );
  } else if (output?.length) {
    dispatch(
      updateToolCallOutput({
        toolCallId,
        contextItems: output,
        mcpUiState,
      }),
    );

    // Kilocode-parity: todoWrite/todoRead tools emit a context item
    // with a `uri.type` discriminator. Mirror that list into the
    // `todos` slice so TaskHeader > TodoStrip stays in sync with the
    // agent's own view.
    //
    // The core ContextItem.uri.type is typed as "file" | "url" by
    // core/index.d.ts; the plan tool sets type to an extension value
    // via `as any`, and we follow suit here. Widen via a local cast
    // so a narrow-type change in core doesn't propagate.
    for (const item of output) {
      const uri = item.uri as
        | { type: string; value: string }
        | null
        | undefined;
      if (!uri || (uri.type !== "todo_write" && uri.type !== "todo_read")) {
        continue;
      }
      try {
        const parsed = JSON.parse(uri.value) as TodoItem[];
        if (Array.isArray(parsed)) {
          dispatch(setTodos(parsed));
        }
      } catch {
        // Malformed payload — leave the existing list untouched so
        // the user doesn't see the strip flash empty because of a
        // single bad emit.
      }
    }
  }

  // Capture telemetry for tool call execution outcome with duration
  const duration_ms = Date.now() - startTime;
  posthog.capture("tool_call_outcome", {
    model: selectedChatModel,
    succeeded: !error,
    toolName: toolCallState.toolCall.function.name,
    errorReason: error?.reason,
    duration_ms: duration_ms,
  });

  if (streamResponse) {
    if (error) {
      logToolUsage(toolCallState, false, false, extra.ideMessenger, output);
      dispatch(
        errorToolCall({
          toolCallId,
        }),
      );
    } else {
      logToolUsage(toolCallState, true, true, extra.ideMessenger, output);
      dispatch(
        acceptToolCall({
          toolCallId,
        }),
      );
    }

    // Send to the LLM to continue the conversation
    const wrapped = await dispatch(
      streamResponseAfterToolCall({
        toolCallId,
        depth: depth + 1,
      }),
    );
    unwrapResult(wrapped);
  } else {
    dispatch(setInactive());
  }
});
