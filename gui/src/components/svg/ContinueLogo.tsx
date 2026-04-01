import { vscForeground } from "..";

interface ContinueLogoProps {
  height?: number;
  width?: number;
}

export default function ContinueLogo({
  height = 75,
}: ContinueLogoProps) {
  const iconSize = Math.max(height * 0.5, 20);
  const fontSize = Math.max(height * 0.28, 14);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: `${Math.max(height * 0.12, 6)}px`,
      }}
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
          fill="#059669"
          opacity="0.15"
          stroke="#10b981"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9 12l2 2 4-4"
          stroke="#10b981"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        style={{
          fontSize: `${fontSize}px`,
          fontWeight: 700,
          color: vscForeground,
          fontFamily: "Inter, system-ui, -apple-system, sans-serif",
          letterSpacing: "-0.02em",
          lineHeight: 1,
        }}
      >
        AI Firewall
      </span>
    </div>
  );
}
