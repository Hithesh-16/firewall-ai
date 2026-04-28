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
  setActivePlan,
  setInactive,
  setPendingPlanProposal,
  setToolCallCalling,
  updateToolCallOutput,
} from "../slices/sessionSlice";
import { setTodos, type TodoItem } from "../slices/todosSlice";
import { ThunkApiType } from "../store";
import { findToolCallById, logToolUsage } from "../util";
import { streamResponseAfterToolCall } from "./streamResponseAfterToolCall";

/**
 * Guard against agents that spin on the same tool. Two triggers:
 *
 *   - IDENTICAL_THRESHOLD = 3 completed calls with identical
 *     (name, args) within the recent window. Catches "retry the exact
 *     same view_repo_map" loops even when a different tool call was
 *     interleaved between repeats.
 *
 *   - SAME_NAME_THRESHOLD = 5 completed calls to the same tool name
 *     (any args) within WINDOW_TURNS assistant turns. Catches
 *     agents that vary args slightly but still spin — e.g. reading
 *     10 different files to "understand the codebase" without making
 *     progress.
 *
 * Pending tool calls (status "generated"/"calling") are skipped so the
 * current in-flight call doesn't short-circuit the scan. Only `done`
 * and `errored` calls count toward either threshold.
 */
const IDENTICAL_THRESHOLD = 3;
const SAME_NAME_THRESHOLD = 5;
const WINDOW_TURNS = 8;

function isLoopingToolCall(
  history: ReadonlyArray<{
    message: { role: string };
    toolCallStates?: Array<{
      status: string;
      toolCall: { function: { name: string; arguments?: string } };
    }>;
  }>,
  candidate: { name: string; arguments?: string },
): boolean {
  let identical = 0;
  let sameName = 0;
  let turnsScanned = 0;
  const candidateArgs = candidate.arguments ?? "";

  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];
    if (item.message.role !== "assistant") continue;
    turnsScanned += 1;
    if (turnsScanned > WINDOW_TURNS) break;

    const states = item.toolCallStates ?? [];
    for (const st of states) {
      if (st.status !== "done" && st.status !== "errored") continue;
      const fn = st.toolCall.function;
      if (fn.name !== candidate.name) continue;
      sameName += 1;
      if ((fn.arguments ?? "") === candidateArgs) identical += 1;
      if (identical >= IDENTICAL_THRESHOLD) return true;
      if (sameName >= SAME_NAME_THRESHOLD) return true;
    }
  }
  return false;
}

// ── Idempotency Locking ───────────────────────────────────────────────────────
// Redux state transitions (generated -> calling) are asynchronous. If a tool
// is approved twice rapidly, or if two orchestrators trigger it at once, we
// must lock it at the module level synchronously to prevent double execution.
const inFlightToolCalls = new Set<string>();

export const callToolById = createAsyncThunk<
  void,
  { toolCallId: string; isAutoApproved?: boolean; depth?: number },
  ThunkApiType
>("chat/callTool", async (inputs, { dispatch, extra, getState }) => {
  const { toolCallId, isAutoApproved, depth = 0 } = inputs;

  if (inFlightToolCalls.has(toolCallId)) {
    return;
  }
  inFlightToolCalls.add(toolCallId);

  const cleanup = () => {
    inFlightToolCalls.delete(toolCallId);
  };

  try {
    const state = getState();
    const toolCallState = findToolCallById(state.session.history, toolCallId);
    if (!toolCallState) {
      console.warn(`Tool call with ID ${toolCallId} not found`);
      return;
    }

    if (toolCallState.status !== "generated") {
      return;
    }

    // Loop guard: if the agent has just completed the same (name, args)
    // tool call LOOP_THRESHOLD times in a row, fail this invocation with
    // an error context item so the model stops retrying and responds to
    // the user instead of burning another round-trip.
    const toolName = toolCallState.toolCall.function.name;
    const toolArgs = toolCallState.toolCall.function.arguments;
    if (
      isLoopingToolCall(state.session.history, {
        name: toolName,
        arguments: toolArgs,
      })
    ) {
      dispatch(
        updateToolCallOutput({
          toolCallId,
          contextItems: [
            {
              icon: "problems",
              name: "Tool call loop detected",
              description: "Same tool + arguments repeated too many times",
              content:
                `The ${toolName} tool has been called repeatedly (>=${IDENTICAL_THRESHOLD} identical or >=${SAME_NAME_THRESHOLD} total within ${WINDOW_TURNS} turns) ` +
                `and has produced no new information. Do NOT call this tool again. ` +
                `Answer the user from the context you already have, or try a different approach.`,
              hidden: false,
            },
          ],
        }),
      );
      dispatch(errorToolCall({ toolCallId }));
      dispatch(
        streamResponseAfterToolCall({
          toolCallId,
          depth: depth + 1,
        }),
      );
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
        if (!uri) continue;

        if (uri.type === "todo_write" || uri.type === "todo_read") {
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
          continue;
        }

        if (uri.type === "plan_proposal") {
          try {
            const parsed = JSON.parse(uri.value) as {
              title: string;
              summary: string;
              risk?: string;
              tasks: Array<{ content: string; status: string; phase?: string }>;
            };
            dispatch(
              setPendingPlanProposal({
                title: parsed.title,
                summary: parsed.summary,
                risk: parsed.risk,
                tasks: parsed.tasks.map((t) => ({
                  content: t.content,
                  phase: t.phase,
                  status: (t.status === "completed"
                    ? "completed"
                    : t.status === "in_progress"
                      ? "in_progress"
                      : "pending") as "pending" | "in_progress" | "completed",
                })),
              }),
            );
          } catch {
            // Malformed proposal — just show the markdown fallback.
          }
          continue;
        }

        if (uri.type === "plan") {
          // create_plan committed directly without the proposal gate.
          try {
            const parsed = JSON.parse(uri.value) as {
              title: string;
              tasks: Array<{ content: string; status: string; phase?: string }>;
            };
            dispatch(
              setActivePlan({
                title: parsed.title,
                tasks: parsed.tasks.map((t) => ({
                  content: t.content,
                  phase: t.phase,
                  status: (t.status === "completed"
                    ? "completed"
                    : t.status === "in_progress"
                      ? "in_progress"
                      : "pending") as "pending" | "in_progress" | "completed",
                })),
              }),
            );
          } catch {
            /* fall back to markdown render */
          }
          continue;
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
      dispatch(
        streamResponseAfterToolCall({
          toolCallId,
          depth: depth + 1,
        }),
      );
    } else {
      dispatch(setInactive());
    }
  } finally {
    cleanup();
  }
});
