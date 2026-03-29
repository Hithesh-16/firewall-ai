interface ContinueSignetProps {
  height?: number;
  width?: number;
  className?: string;
}

/**
 * AI Firewall shield signet icon
 */
export default function ContinueSignet({
  height = 32,
  width = 32,
  className = "",
}: ContinueSignetProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
        fill="currentColor"
        opacity="0.15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x="12"
        y="14.5"
        textAnchor="middle"
        fill="currentColor"
        fontSize="7"
        fontWeight="700"
        fontFamily="Inter, system-ui, sans-serif"
      >
        AF
      </text>
    </svg>
  );
}
