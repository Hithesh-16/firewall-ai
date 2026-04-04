import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface MemoryEntry {
  fileName: string;
  name: string;
  description: string;
  type: "user" | "feedback" | "project" | "reference";
  body: string;
}

interface MemoryState {
  memories: MemoryEntry[];
  indexContent: string;
  loading: boolean;
  error: string | null;
}

const initialState: MemoryState = {
  memories: [],
  indexContent: "",
  loading: false,
  error: null,
};

export const memorySlice = createSlice({
  name: "memory",
  initialState,
  reducers: {
    setMemories: (state, action: PayloadAction<MemoryEntry[]>) => {
      state.memories = action.payload;
    },
    addMemory: (state, action: PayloadAction<MemoryEntry>) => {
      state.memories = [...state.memories, action.payload];
    },
    removeMemory: (state, action: PayloadAction<string>) => {
      state.memories = state.memories.filter(
        (m) => m.fileName !== action.payload,
      );
    },
    setIndexContent: (state, action: PayloadAction<string>) => {
      state.indexContent = action.payload;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
  },
});

export const {
  setMemories,
  addMemory,
  removeMemory,
  setIndexContent,
  setLoading,
  setError,
} = memorySlice.actions;

export default memorySlice.reducer;
