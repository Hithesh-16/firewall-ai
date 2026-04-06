import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "../../utils/cn";

interface StreamingResponseProps {
  content: string;
  streaming: boolean;
  className?: string;
}

export function StreamingResponse({
  content,
  streaming,
  className,
}: StreamingResponseProps) {
  return (
    <div
      className={cn(
        "prose-invert text-foreground max-w-none text-sm leading-relaxed",
        className,
      )}
    >
      <ReactMarkdown
        components={{
          code({ className: codeClassName, children, ...props }) {
            const match = /language-(\w+)/.exec(codeClassName || "");
            const codeString = String(children).replace(/\n$/, "");

            if (match) {
              return (
                <div className="border-border group relative my-3 overflow-hidden rounded-lg border">
                  <div className="border-border bg-secondary flex items-center justify-between border-b px-3 py-1.5">
                    <span className="text-description-muted text-xs">
                      {match[1]}
                    </span>
                    <button
                      type="button"
                      className="text-description-muted hover:text-foreground text-xs opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => {
                        void navigator.clipboard.writeText(codeString);
                      }}
                      aria-label="Copy code"
                    >
                      Copy
                    </button>
                  </div>
                  <SyntaxHighlighter
                    style={oneDark}
                    language={match[1]}
                    PreTag="div"
                    customStyle={{
                      margin: 0,
                      borderRadius: 0,
                      background: "transparent",
                      fontSize: "13px",
                    }}
                  >
                    {codeString}
                  </SyntaxHighlighter>
                </div>
              );
            }

            return (
              <code
                className="bg-secondary text-accent rounded px-1.5 py-0.5 text-[13px]"
                {...props}
              >
                {children}
              </code>
            );
          },
          p({ children }) {
            return <p className="mb-3 last:mb-0">{children}</p>;
          },
          ul({ children }) {
            return <ul className="mb-3 list-disc pl-6">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="mb-3 list-decimal pl-6">{children}</ol>;
          },
          li({ children }) {
            return <li className="mb-1">{children}</li>;
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-link hover:underline"
              >
                {children}
              </a>
            );
          },
          h1({ children }) {
            return (
              <h1 className="text-foreground mb-3 mt-4 text-lg font-semibold">
                {children}
              </h1>
            );
          },
          h2({ children }) {
            return (
              <h2 className="text-foreground mb-2 mt-3 text-base font-semibold">
                {children}
              </h2>
            );
          },
          h3({ children }) {
            return (
              <h3 className="text-foreground mb-2 mt-3 text-sm font-semibold">
                {children}
              </h3>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-border text-description my-3 border-l-2 pl-4">
                {children}
              </blockquote>
            );
          },
          hr() {
            return <hr className="border-border my-4" />;
          },
          table({ children }) {
            return (
              <div className="my-3 overflow-x-auto">
                <table className="border-border min-w-full border-collapse border text-sm">
                  {children}
                </table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="border-border bg-secondary text-foreground border px-3 py-1.5 text-left font-medium">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="border-border border px-3 py-1.5">{children}</td>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
      {streaming && (
        <span className="bg-primary inline-block h-4 w-1.5 animate-pulse rounded-sm" />
      )}
    </div>
  );
}
