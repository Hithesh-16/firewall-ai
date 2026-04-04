/**
 * SideBySideDiff — two-column diff view showing old and new side by side.
 */

interface SideLine {
  content: string;
  type: "same" | "changed" | "empty";
}

interface SideBySideDiffProps {
  oldLines: string[];
  newLines: string[];
  fileName?: string;
  maxHeight?: string;
}

export function SideBySideDiff({
  oldLines,
  newLines,
  fileName,
  maxHeight = "400px",
}: SideBySideDiffProps) {
  const pairs = alignLines(oldLines, newLines);

  return (
    <div className="border-border overflow-hidden rounded border">
      {fileName && (
        <div className="bg-secondary-background border-border border-b px-3 py-1.5">
          <span className="text-2xs text-description font-mono">
            {fileName}
          </span>
        </div>
      )}
      <div className="overflow-auto" style={{ maxHeight }}>
        <div className="divide-border text-2xs grid grid-cols-2 divide-x font-mono">
          {/* Old (left) */}
          <div>
            <div className="bg-error/5 border-border text-2xs text-error border-b px-2 py-1 font-semibold">
              Old
            </div>
            {pairs.map((pair, i) => (
              <div
                key={`old-${i}`}
                className={`whitespace-pre px-2 py-0.5 ${
                  pair.old.type === "changed"
                    ? "bg-error/10 text-error"
                    : pair.old.type === "empty"
                      ? "bg-secondary-background text-description-muted"
                      : "text-foreground"
                }`}
              >
                {pair.old.content || "\u00A0"}
              </div>
            ))}
          </div>

          {/* New (right) */}
          <div>
            <div className="bg-success/5 border-border text-2xs text-success border-b px-2 py-1 font-semibold">
              New
            </div>
            {pairs.map((pair, i) => (
              <div
                key={`new-${i}`}
                className={`whitespace-pre px-2 py-0.5 ${
                  pair.new.type === "changed"
                    ? "bg-success/10 text-success"
                    : pair.new.type === "empty"
                      ? "bg-secondary-background text-description-muted"
                      : "text-foreground"
                }`}
              >
                {pair.new.content || "\u00A0"}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Simple line alignment — matches same lines, marks differences.
 * For a production diff, use a proper LCS algorithm.
 */
function alignLines(
  oldLines: string[],
  newLines: string[],
): Array<{ old: SideLine; new: SideLine }> {
  const maxLen = Math.max(oldLines.length, newLines.length);
  const pairs: Array<{ old: SideLine; new: SideLine }> = [];

  for (let i = 0; i < maxLen; i++) {
    const oldContent = i < oldLines.length ? oldLines[i] : "";
    const newContent = i < newLines.length ? newLines[i] : "";

    const oldType: SideLine["type"] =
      i >= oldLines.length
        ? "empty"
        : oldContent === newContent
          ? "same"
          : "changed";
    const newType: SideLine["type"] =
      i >= newLines.length
        ? "empty"
        : oldContent === newContent
          ? "same"
          : "changed";

    pairs.push({
      old: { content: oldContent, type: oldType },
      new: { content: newContent, type: newType },
    });
  }

  return pairs;
}
