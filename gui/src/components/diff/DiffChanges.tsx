/**
 * Additions / deletions summary pill (kilocode-parity).
 *
 * Used in FileAccordion headers and the MultiFileDiffPanel summary
 * row. Zero values render as "·" so the badge never looks broken
 * when a file only added or only deleted lines.
 */
export function DiffChanges({
  additions,
  deletions,
  className = "",
}: {
  additions: number;
  deletions: number;
  className?: string;
}) {
  return (
    <span
      className={`flex items-center gap-1 font-mono text-[11px] tabular-nums ${className}`}
      aria-label={`${additions} additions, ${deletions} deletions`}
    >
      <span className="text-success">
        {additions > 0 ? `+${additions}` : "·"}
      </span>
      <span className="text-error">
        {deletions > 0 ? `−${deletions}` : "·"}
      </span>
    </span>
  );
}
