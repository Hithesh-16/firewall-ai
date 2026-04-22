import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiClient } from "../api/client";

/**
 * Server-driven table controls (P11-SERVER).
 *
 * Builds URLs of shape `${endpoint}?page=N&pageSize=M&search=...` and
 * fetches `{items, total, page, pageSize, hasMore}` — the uniform
 * contract documented in ui-polish-plan.md §4c.
 *
 * The hook owns:
 *   - page / pageSize / search state
 *   - debounced search (300ms default) so typing doesn't fire a
 *     request per keystroke
 *   - fetch lifecycle (loading / error)
 *   - re-fetch on any of the above changing
 *
 * Callers get `items`, `total`, `page`, `pageSize`, `totalPages`,
 * `loading`, `error`, plus `setPage` and `setSearch`. Plus `refetch`
 * for callbacks that just performed a mutation and want to pull a
 * fresh page without changing the controls.
 *
 * Endpoint contract the backend needs to honour:
 *   GET ${endpoint}?page=1&pageSize=20&search=...
 *     → { items: T[], total: number, page: number, pageSize: number, hasMore?: boolean }
 *
 * Legacy compatibility: if the backend also returns a legacy key
 * (e.g. `{users: T[]}` alongside `items`), the hook unwraps `items`
 * first and falls back to the legacy key when provided.
 */
export interface UseServerTableOptions {
  /** Full path including leading slash, e.g. "/api/admin/users". */
  endpoint: string;
  /** Default 20, max 100 (backend also clamps). */
  pageSize?: number;
  /** Debounce window for the search input. Default 300ms. */
  searchDebounceMs?: number;
  /** Fires alongside the fetch — useful for analytics / telemetry. */
  onFetch?: (params: { page: number; search: string }) => void;
  /**
   * Extra query params appended to every request. Caller manages the
   * reference equality; when it changes the hook refetches.
   */
  extraQuery?: Record<string, string | number | undefined>;
  /** When false, the hook holds off on fetching. Useful while auth
   *  is still hydrating. Default true. */
  enabled?: boolean;
  /** Legacy response key to look at if `items` is missing — e.g.
   *  "users", "roles", "logs". Optional. */
  legacyKey?: string;
}

export interface UseServerTableResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
  search: string;
  setPage: (next: number) => void;
  setSearch: (next: string) => void;
  refetch: () => void;
}

export function useServerTable<T>(options: UseServerTableOptions): UseServerTableResult<T> {
  const {
    endpoint,
    pageSize: initialPageSize = 20,
    searchDebounceMs = 300,
    onFetch,
    extraQuery,
    enabled = true,
    legacyKey,
  } = options;

  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPageRaw] = useState(1);
  const [pageSize] = useState(initialPageSize);
  const [search, setSearchImmediate] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const extraQueryKey = useMemo(() => JSON.stringify(extraQuery ?? {}), [extraQuery]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (debouncedSearch.length > 0) params.set("search", debouncedSearch);
      if (extraQuery) {
        for (const [k, v] of Object.entries(extraQuery)) {
          if (v !== undefined && v !== null && v !== "") {
            params.set(k, String(v));
          }
        }
      }
      const url = `${endpoint}?${params.toString()}`;
      onFetch?.({ page, search: debouncedSearch });
      const resp = await apiClient.get<{
        items?: T[];
        total?: number;
        page?: number;
        pageSize?: number;
        [k: string]: any;
      }>(url);
      const nextItems: T[] = Array.isArray(resp?.items)
        ? (resp.items as T[])
        : legacyKey && Array.isArray(resp?.[legacyKey])
          ? (resp[legacyKey] as T[])
          : [];
      setItems(nextItems);
      setTotal(typeof resp?.total === "number" ? resp.total : nextItems.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, page, pageSize, debouncedSearch, enabled, extraQueryKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const setPage = useCallback(
    (next: number) => {
      setPageRaw(Math.max(1, Math.min(next, totalPages)));
    },
    [totalPages],
  );

  const setSearch = useCallback(
    (next: string) => {
      setSearchImmediate(next);
      // Reset page on every new term so users land on page 1 when the
      // result set shrinks. Debounced fetch fires after the window.
      setPageRaw(1);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        setDebouncedSearch(next);
      }, searchDebounceMs);
    },
    [searchDebounceMs],
  );

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    loading,
    error,
    search,
    setPage,
    setSearch,
    refetch: fetchData,
  };
}
