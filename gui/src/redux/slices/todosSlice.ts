import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/**
 * Agent todo list slice (kilocode-parity).
 *
 * Backs the TodoStrip inside TaskHeader. The agent calls todoWrite /
 * todoRead tools; the stream handler mirrors their effects here so
 * the UI sees checkbox updates live as the agent makes progress.
 *
 * Design notes:
 *  - Flat array is deliberate. Nested todo groups aren't a thing in
 *    kilocode either; users have always read the list top-to-bottom.
 *  - `clearTodos` is called on newSession so a list from a previous
 *    conversation doesn't leak into a fresh chat.
 *  - `setTodos` replaces wholesale — cheapest way to reconcile a tool
 *    that returns the entire list on every call. `updateTodoStatus`
 *    is the granular path for streaming single-item updates.
 */

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  /**
   * Optional phase / section heading (P9). When any items share a
   * phase string, TodoStrip renders them as grouped sections with
   * per-phase progress bars. Omit for a flat checklist.
   */
  phase?: string;
}

const initialState: TodoItem[] = [];

const todosSlice = createSlice({
  name: "todos",
  initialState,
  reducers: {
    setTodos(_state, action: PayloadAction<TodoItem[]>) {
      return action.payload;
    },
    updateTodoStatus(
      state,
      action: PayloadAction<{ id: string; status: TodoStatus }>,
    ) {
      const todo = state.find((t) => t.id === action.payload.id);
      if (todo) {
        todo.status = action.payload.status;
      }
    },
    addTodo(state, action: PayloadAction<TodoItem>) {
      if (!state.some((t) => t.id === action.payload.id)) {
        state.push(action.payload);
      }
    },
    removeTodo(state, action: PayloadAction<string>) {
      return state.filter((t) => t.id !== action.payload);
    },
    clearTodos() {
      return [];
    },
  },
  extraReducers: (builder) => {
    // Wipe the todo list whenever sessionSlice.newSession fires so a
    // previous conversation's list doesn't bleed into a fresh chat.
    // Matched by action type string to avoid a cross-slice import cycle.
    builder.addCase("session/newSession", (state, action: any) => {
      // Wipe the todo list whenever sessionSlice.newSession fires
      // so a previous conversation's list doesn't bleed into a fresh chat.
      return [];
    });
  },
});

export const { setTodos, updateTodoStatus, addTodo, removeTodo, clearTodos } =
  todosSlice.actions;

export default todosSlice.reducer;
