import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "../index";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  scanResult?: {
    action: string;
    riskScore: number;
    secretsFound: number;
    piiFound: number;
  };
  cost?: {
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
  };
  model?: string;
  streaming?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  model: string;
  createdAt: number;
  updatedAt: number;
}

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  selectedModel: string;
  streaming: boolean;
  inputText: string;
  artifactPanelOpen: boolean;
  artifactContent: string | null;
  artifactLanguage: string | null;
}

const initialState: ChatState = {
  conversations: [],
  activeConversationId: null,
  selectedModel: "gpt-4",
  streaming: false,
  inputText: "",
  artifactPanelOpen: false,
  artifactContent: null,
  artifactLanguage: null,
};

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export const chatSlice = createSlice({
  name: "chat",
  initialState,
  reducers: {
    createConversation(state) {
      const id = generateId();
      const now = Date.now();
      const conversation: Conversation = {
        id,
        title: "New Conversation",
        messages: [],
        model: state.selectedModel,
        createdAt: now,
        updatedAt: now,
      };
      return {
        ...state,
        conversations: [conversation, ...state.conversations],
        activeConversationId: id,
      };
    },
    setActiveConversation(state, action: PayloadAction<string>) {
      return { ...state, activeConversationId: action.payload };
    },
    addMessage(
      state,
      action: PayloadAction<{ convId: string; message: ChatMessage }>,
    ) {
      const { convId, message } = action.payload;
      return {
        ...state,
        conversations: state.conversations.map((conv) =>
          conv.id === convId
            ? {
                ...conv,
                messages: [...conv.messages, message],
                updatedAt: Date.now(),
                title:
                  conv.messages.length === 0 && message.role === "user"
                    ? message.content.slice(0, 50)
                    : conv.title,
              }
            : conv,
        ),
      };
    },
    updateMessage(
      state,
      action: PayloadAction<{
        convId: string;
        msgId: string;
        partial: Partial<ChatMessage>;
      }>,
    ) {
      const { convId, msgId, partial } = action.payload;
      return {
        ...state,
        conversations: state.conversations.map((conv) =>
          conv.id === convId
            ? {
                ...conv,
                messages: conv.messages.map((msg) =>
                  msg.id === msgId ? { ...msg, ...partial } : msg,
                ),
                updatedAt: Date.now(),
              }
            : conv,
        ),
      };
    },
    setStreaming(state, action: PayloadAction<boolean>) {
      return { ...state, streaming: action.payload };
    },
    setSelectedModel(state, action: PayloadAction<string>) {
      return { ...state, selectedModel: action.payload };
    },
    setInputText(state, action: PayloadAction<string>) {
      return { ...state, inputText: action.payload };
    },
    deleteConversation(state, action: PayloadAction<string>) {
      const remaining = state.conversations.filter(
        (c) => c.id !== action.payload,
      );
      return {
        ...state,
        conversations: remaining,
        activeConversationId:
          state.activeConversationId === action.payload
            ? (remaining[0]?.id ?? null)
            : state.activeConversationId,
      };
    },
    setArtifactPanel(
      state,
      action: PayloadAction<{
        open: boolean;
        content?: string;
        language?: string;
      }>,
    ) {
      return {
        ...state,
        artifactPanelOpen: action.payload.open,
        artifactContent: action.payload.content ?? state.artifactContent,
        artifactLanguage: action.payload.language ?? state.artifactLanguage,
      };
    },
  },
});

export const {
  createConversation,
  setActiveConversation,
  addMessage,
  updateMessage,
  setStreaming,
  setSelectedModel,
  setInputText,
  deleteConversation,
  setArtifactPanel,
} = chatSlice.actions;

export const selectActiveConversation = (state: RootState) => {
  const { conversations, activeConversationId } = state.chat;
  if (!activeConversationId) return null;
  return conversations.find((c) => c.id === activeConversationId) ?? null;
};

export const selectActiveMessages = (state: RootState) => {
  const conv = selectActiveConversation(state);
  return conv?.messages ?? [];
};

export default chatSlice.reducer;
