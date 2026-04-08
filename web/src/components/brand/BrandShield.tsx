import { ShieldCheckIcon } from "@heroicons/react/24/outline";

interface BrandShieldProps {
  /** Size in pixels of the outer ring (default 80). */
  size?: number;
  /** Whether to animate with a pulsing glow (default true). */
  pulse?: boolean;
}

/**
 * BrandShield — the AI Firewall identity mark.
 *
 * A glowing emerald shield on a subtle gradient disk, optionally with a
 * pulsing ring to draw the eye. Used on Landing / Login / Register.
 */
export default function BrandShield({ size = 80, pulse = true }: BrandShieldProps) {
  const iconSize = Math.round(size * 0.55);
  return (
    <div className="relative inline-flex items-center justify-center">
      <div
        className={pulse ? "afw-animate-pulse-ring" : undefined}
        style={{
          width: size,
          height: size,
          borderRadius: "1.5rem",
          background: "linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(6, 182, 212, 0.25))",
          border: "1px solid rgba(16, 185, 129, 0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 0 40px rgba(16, 185, 129, 0.25), inset 0 0 20px rgba(16, 185, 129, 0.15)",
          backdropFilter: "blur(8px)",
        }}
      >
        <ShieldCheckIcon
          style={{
            width: iconSize,
            height: iconSize,
            color: "#10b981",
            filter: "drop-shadow(0 0 12px rgba(16, 185, 129, 0.55))",
          }}
        />
      </div>
    </div>
  );
}
