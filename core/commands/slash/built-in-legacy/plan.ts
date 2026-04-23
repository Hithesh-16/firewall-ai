import { ChatMessage, SlashCommand } from "../../../index.js";
import { renderChatMessage } from "../../../util/messageContent.js";

/**
 * /plan — Force the agent to propose a plan before touching anything.
 *
 * Usage:
 *   /plan migrate the auth middleware to use JWT
 *   /plan refactor the proxy router to support streaming
 *
 * The slash command rewrites the user's task into a directive that
 * instructs the model to call `propose_plan` first and stop. The
 * PlanProposalCard then renders with Approve / Revise buttons, giving
 * the user an approval gate before any code changes happen.
 *
 * Mirrors Claude Code's `/plan` behaviour and kilocode's `plan` mode
 * entry — the intent is a one-shot promotion into planning flow
 * without having to manually switch the chat mode dropdown.
 */

function lastUserText(history: ChatMessage[]): string {
  const reversed = [...history].reverse();
  const last = reversed.find((m) => m.role === "user");
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  if (Array.isArray(last.content)) {
    return last.content
      .map((p) => (p.type === "text" ? p.text : ""))
      .join(" ")
      .trim();
  }
  return "";
}

function stripInvocation(text: string): string {
  return text
    .replace(/^\s*\/plan\b/i, "")
    .replace(/^\s*\\plan\b/i, "")
    .trim();
}

const PlanSlashCommand: SlashCommand = {
  name: "plan",
  description:
    "Propose an approval-gated plan for the task before any changes are made.",
  run: async function* ({ llm, history, abortController }) {
    const rawTask = stripInvocation(lastUserText(history));
    const task =
      rawTask.length > 0
        ? rawTask
        : "(no task provided — ask the user to describe what they want planned)";

    const directive = [
      "The user invoked /plan. You are now in structured planning mode for this turn.",
      "",
      "Rules:",
      "  1. Call the `propose_plan` tool BEFORE any other tool call. Do not read files, run commands, or edit anything first.",
      "  2. After `propose_plan`, STOP and wait for the user to approve or revise. Do not chain additional tool calls in the same turn.",
      "  3. The plan must include: a short title, a 1-3 sentence summary (intent + impact + files/areas touched), and an ordered task list with {content, status: 'pending'} entries.",
      "  4. Set an honest risk level: 'high' for auth/schema/CI/deletes, 'medium' for multi-file refactors, 'low' for isolated changes.",
      "  5. Do NOT write code in this turn. If the task is trivial enough that a plan is overkill, say so in one sentence and ask the user to re-send without /plan.",
      "",
      `Task: ${task}`,
    ].join("\n");

    for await (const chunk of llm.streamChat(
      [{ role: "user", content: directive }],
      abortController.signal,
    )) {
      yield renderChatMessage(chunk);
    }
  },
};

export default PlanSlashCommand;
