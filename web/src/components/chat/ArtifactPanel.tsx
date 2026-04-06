import { XMarkIcon, ClipboardDocumentIcon } from "@heroicons/react/24/outline";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { setArtifactPanel } from "../../store/slices/chatSlice";
import { useState } from "react";

export function ArtifactPanel() {
  const dispatch = useAppDispatch();
  const { artifactPanelOpen, artifactContent, artifactLanguage } =
    useAppSelector((s) => s.chat);
  const [copied, setCopied] = useState(false);

  if (!artifactPanelOpen || !artifactContent) return null;

  function handleClose() {
    dispatch(setArtifactPanel({ open: false }));
  }

  function handleCopy() {
    if (!artifactContent) return;
    void navigator.clipboard.writeText(artifactContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="border-border bg-editor flex h-full w-[40vw] min-w-[320px] max-w-[600px] flex-col border-l">
      {/* Header */}
      <div className="border-border flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-foreground text-sm font-medium">Artifact</span>
          {artifactLanguage && (
            <span className="bg-secondary text-description-muted rounded px-2 py-0.5 text-xs">
              {artifactLanguage}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            className="text-description hover:bg-list-hover hover:text-foreground rounded-lg p-1.5"
            aria-label="Copy content"
          >
            <ClipboardDocumentIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="text-description hover:bg-list-hover hover:text-foreground rounded-lg p-1.5"
            aria-label="Close artifact panel"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Copied indicator */}
      {copied && (
        <div className="border-border bg-success/10 text-success border-b px-4 py-1.5 text-xs">
          Copied to clipboard
        </div>
      )}

      {/* Content */}
      <div className="thin-scrollbar flex-1 overflow-auto">
        <SyntaxHighlighter
          style={oneDark}
          language={artifactLanguage ?? "text"}
          showLineNumbers
          customStyle={{
            margin: 0,
            borderRadius: 0,
            background: "transparent",
            fontSize: "13px",
            minHeight: "100%",
          }}
        >
          {artifactContent}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
