import { useContext, useEffect, useState } from "react";

import { IdeMessengerContext } from "../context/IdeMessenger";
import { useWebviewListener } from "./useWebviewListener";

/**
 * Canonical source of truth for "is the user signed in to AI Firewall?".
 *
 * Reads the state maintained by `AiFirewallAuthService` in the extension
 * host and stays in sync with it via the `aiFirewall/authState` push
 * event. One hook, any surface (AccountDropdown, Layout, gates) — so
 * every sign-in indicator agrees without duplicate polling.
 *
 * On mount:
 *   1. Request `aiFirewall/getAuthState` (hydrate before any push event).
 *   2. Subscribe to `aiFirewall/authState` push events so later changes
 *      (cross-process sign-in, watcher fire, sign-out) propagate live.
 *
 * Returns `{signedIn, email, userId, ready}` where `ready` flips true
 * once the initial IPC call has resolved — lets callers render a subtle
 * skeleton instead of flashing "Sign in" briefly on webview boot.
 */
export interface AiFirewallAuthSnapshot {
  signedIn: boolean;
  email?: string;
  name?: string;
  role?: string;
  userId?: number;
  ready: boolean;
}

const INITIAL: AiFirewallAuthSnapshot = {
  signedIn: false,
  ready: false,
};

export function useAiFirewallAuth(): AiFirewallAuthSnapshot {
  const ideMessenger = useContext(IdeMessengerContext);
  const [state, setState] = useState<AiFirewallAuthSnapshot>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await ideMessenger.request(
          "aiFirewall/getAuthState",
          undefined,
        );
        if (cancelled) return;
        if (response.status === "success") {
          setState({
            signedIn: !!response.content.signedIn,
            email: response.content.email,
            name: response.content.name,
            role: response.content.role,
            userId: response.content.userId,
            ready: true,
          });
        } else {
          setState((s) => ({ ...s, ready: true }));
        }
      } catch {
        if (!cancelled) setState((s) => ({ ...s, ready: true }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ideMessenger]);

  useWebviewListener(
    "aiFirewall/authState",
    async (data) => {
      setState({
        signedIn: !!data.signedIn,
        email: data.email,
        name: data.name,
        role: data.role,
        userId: data.userId,
        ready: true,
      });
    },
    [],
  );

  return state;
}
