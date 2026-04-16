/**
 * Suspense fallback for lazy-loaded route chunks. Kept intentionally
 * minimal — a full-screen spinner that matches the app theme so route
 * transitions don't flash unstyled content.
 */
export function RouteFallback() {
  return (
    <div
      className="bg-background text-description flex h-screen items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <span>Loading…</span>
    </div>
  );
}
