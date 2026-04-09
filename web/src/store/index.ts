import { configureStore, combineReducers } from "@reduxjs/toolkit";
import authReducer from "./slices/authSlice";
import uiReducer from "./slices/uiSlice";
import chatReducer from "./slices/chatSlice";
import securityReducer from "./slices/securitySlice";
import orgReducer from "./slices/orgSlice";
import { onboardingReducer } from "./slices/onboardingSlice";
import { permissionsReducer } from "./slices/permissionsSlice";

const rootReducer = combineReducers({
  auth: authReducer,
  ui: uiReducer,
  chat: chatReducer,
  security: securityReducer,
  org: orgReducer,
  onboarding: onboardingReducer,
  permissions: permissionsReducer,
});

export const store = configureStore({ reducer: rootReducer });

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
