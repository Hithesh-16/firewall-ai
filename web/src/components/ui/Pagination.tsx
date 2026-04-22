import {
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";

/**
 * Pagination rail (P11).
 *
 * Compact, theme-aware pagination control used alongside DataTable /
 * card lists. Renders:
 *
 *   « ‹ 1 2 … 9 10 › »        Page 2 of 10 · 47 items
 *
 * Shows at most 5 page buttons (current ± 2) with leading/trailing
 * ellipses when there are more pages. Keyboard-navigable: tab to
 * any button + Enter activates it; arrow keys don't move focus by
 * default (respects the browser's default focus order).
 *
 * Auto-hides when `totalPages <= 1` — no point showing `Page 1 of 1`.
 */
export interface PaginationProps {
  /** 1-indexed current page. */
  page: number;
  /** Total pages (min 1). */
  totalPages: number;
  /** Total items across all pages — for the label. */
  total?: number;
  /** Label for the item unit (e.g. "users", "roles"). Defaults to
   *  "items". */
  itemLabel?: string;
  /** Called with the new page when the user clicks a button. */
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({
  page,
  totalPages,
  total,
  itemLabel = "items",
  onPageChange,
  className,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = computePageList(page, totalPages);

  return (
    <nav
      className={cn("flex items-center justify-between gap-4 py-2 text-xs", className)}
      aria-label="Pagination"
    >
      <div className="flex items-center gap-1">
        <PageButton label="First page" onClick={() => onPageChange(1)} disabled={page === 1}>
          <ChevronDoubleLeftIcon className="h-3.5 w-3.5" />
        </PageButton>
        <PageButton
          label="Previous page"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
        >
          <ChevronLeftIcon className="h-3.5 w-3.5" />
        </PageButton>

        {pages.map((p, i) =>
          p === "..." ? (
            <span key={`ellipsis-${i}`} className="text-description-muted px-2" aria-hidden>
              …
            </span>
          ) : (
            <PageButton
              key={p}
              label={`Go to page ${p}`}
              onClick={() => onPageChange(p)}
              active={p === page}
            >
              {p}
            </PageButton>
          ),
        )}

        <PageButton
          label="Next page"
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
        >
          <ChevronRightIcon className="h-3.5 w-3.5" />
        </PageButton>
        <PageButton
          label="Last page"
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages}
        >
          <ChevronDoubleRightIcon className="h-3.5 w-3.5" />
        </PageButton>
      </div>

      <div className="text-description text-xs tabular-nums">
        Page {page} of {totalPages}
        {typeof total === "number" && (
          <>
            <span className="text-description-muted"> · </span>
            {total.toLocaleString()} {itemLabel}
          </>
        )}
      </div>
    </nav>
  );
}

function PageButton({
  children,
  onClick,
  active,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-7 min-w-[1.75rem] items-center justify-center rounded-md border px-2 font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-input text-foreground hover:bg-list-hover",
        disabled && "cursor-not-allowed opacity-40 hover:bg-input",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Compute the list of page numbers (and ellipses) to render.
 *
 * Rules:
 *   - Always show the first and last page.
 *   - Always show the current page and its immediate neighbours.
 *   - Ellipsis where the range skips more than one page.
 *
 * Examples:
 *   page=1, total=20  →  [1, 2, 3, "...", 20]
 *   page=10, total=20 →  [1, "...", 9, 10, 11, "...", 20]
 *   page=20, total=20 →  [1, "...", 18, 19, 20]
 */
function computePageList(page: number, totalPages: number): Array<number | "..."> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages: Array<number | "..."> = [];
  const showLeftEllipsis = page > 4;
  const showRightEllipsis = page < totalPages - 3;

  pages.push(1);
  if (showLeftEllipsis) pages.push("...");

  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  if (showRightEllipsis) pages.push("...");
  pages.push(totalPages);

  return pages;
}
