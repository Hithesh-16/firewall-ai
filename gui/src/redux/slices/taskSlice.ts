import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface TaskProgress {
  toolUseCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface TaskItem {
  id: string;
  type: string;
  status: string;
  description: string;
  progress: TaskProgress | null;
  error: string | null;
  resultSummary: string | null;
  startedAt: number;
  completedAt: number | null;
}

interface TaskState {
  tasks: TaskItem[];
  activeCount: number;
  loading: boolean;
  error: string | null;
}

const initialState: TaskState = {
  tasks: [],
  activeCount: 0,
  loading: false,
  error: null,
};

function countActive(tasks: TaskItem[]): number {
  return tasks.filter((t) => t.status === "pending" || t.status === "running")
    .length;
}

export const taskSlice = createSlice({
  name: "task",
  initialState,
  reducers: {
    setTasks: (state, action: PayloadAction<TaskItem[]>) => {
      state.tasks = action.payload;
      state.activeCount = countActive(action.payload);
    },
    addTask: (state, action: PayloadAction<TaskItem>) => {
      state.tasks = [...state.tasks, action.payload];
      state.activeCount = countActive(state.tasks);
    },
    updateTask: (
      state,
      action: PayloadAction<{ id: string } & Partial<TaskItem>>,
    ) => {
      state.tasks = state.tasks.map((task) =>
        task.id === action.payload.id ? { ...task, ...action.payload } : task,
      );
      state.activeCount = countActive(state.tasks);
    },
    removeTask: (state, action: PayloadAction<string>) => {
      state.tasks = state.tasks.filter((t) => t.id !== action.payload);
      state.activeCount = countActive(state.tasks);
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    clearTasks: (state) => {
      state.tasks = [];
      state.activeCount = 0;
    },
  },
});

export const {
  setTasks,
  addTask,
  updateTask,
  removeTask,
  setLoading,
  setError,
  clearTasks,
} = taskSlice.actions;

export default taskSlice.reducer;
