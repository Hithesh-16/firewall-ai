import { useCallback, useState } from "react";

const PROXY_BASE = "http://localhost:8080";

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Generic hook for calling the AI Firewall proxy REST API.
 * Handles loading/error state and JSON parsing.
 */
export function useProxyApi() {
  const [token] = useState<string | null>(() =>
    localStorage.getItem("afw_token"),
  );

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }, [token]);

  const get = useCallback(
    async <T>(path: string): Promise<T> => {
      const res = await fetch(`${PROXY_BASE}${path}`, { headers: headers() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    [headers],
  );

  const post = useCallback(
    async <T>(path: string, body: unknown): Promise<T> => {
      const res = await fetch(`${PROXY_BASE}${path}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    [headers],
  );

  const patch = useCallback(
    async <T>(path: string, body: unknown): Promise<T> => {
      const res = await fetch(`${PROXY_BASE}${path}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    [headers],
  );

  const del = useCallback(
    async (path: string): Promise<void> => {
      const res = await fetch(`${PROXY_BASE}${path}`, {
        method: "DELETE",
        headers: headers(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
    },
    [headers],
  );

  const put = useCallback(
    async <T>(path: string, body: unknown): Promise<T> => {
      const res = await fetch(`${PROXY_BASE}${path}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    [headers],
  );

  return { get, post, patch, del, put };
}

/**
 * Hook that manages loading/error state for a single API resource.
 */
export function useApiResource<T>(initialData: T | null = null) {
  const [state, setState] = useState<ApiState<T>>({
    data: initialData,
    loading: false,
    error: null,
  });

  const setData = (data: T) => setState({ data, loading: false, error: null });
  const setLoading = () =>
    setState((prev) => ({ ...prev, loading: true, error: null }));
  const setError = (error: string) =>
    setState((prev) => ({ ...prev, loading: false, error }));

  return { ...state, setData, setLoading, setError };
}
