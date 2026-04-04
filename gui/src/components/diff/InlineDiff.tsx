/**
 * InlineDiff — renders a unified diff with red/green line coloring.
 * Used in permission dialogs (FileEdit preview) and code review.
 */

interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
  lineNumber?: number;
}

interface InlineDiffProps {
  lines: DiffLine[];
  fileName?: string;
  maxHeight?: string;
}

export function InlineDiff({
  lines,
  fileName,
  maxHeight = "300px",
}: InlineDiffProps) {
  if (lines.length === 0) {
    return (
      <div className="text-description-muted p-2 text-sm italic">
        No changes
      </div>
    );
  }

  return (
    <div className="border-border overflow-hidden rounded border">
      {fileName && (
        <div className="bg-secondary-background border-border border-b px-3 py-1.5">
          <span className="text-2xs text-description font-mono">
            {fileName}
          </span>
        </div>
      )}
      <div className="text-2xs overflow-auto font-mono" style={{ maxHeight }}>
        {lines.map((line, i) => (
          <div
            key={i}
            className={`whitespace-pre px-3 py-0.5 ${
              line.type === "add"
                ? "bg-success/10 text-success"
                : line.type === "remove"
                  ? "bg-error/10 text-error"
                  : "text-foreground"
            }`}
          >
            <span className="text-description-muted inline-block w-4 select-none">
              {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
            </span>
            {line.content}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Parse a unified diff string into DiffLine array.
 */
export function parseDiffString(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      lines.push({ type: "add", content: raw.slice(1) });
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      lines.push({ type: "remove", content: raw.slice(1) });
    } else if (raw.startsWith("@@")) {
      // Skip hunk headers
      continue;
    } else if (
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("---") ||
      raw.startsWith("+++")
    ) {
      // Skip file headers
      continue;
    } else {
      lines.push({
        type: "context",
        content: raw.startsWith(" ") ? raw.slice(1) : raw,
      });
    }
  }

  return lines;
}
