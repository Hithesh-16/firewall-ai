/**
 * AnimatedBackdrop — the AI Firewall brand background.
 *
 * Performance notes:
 *   - The previous version ran THREE ~60rem blurred blobs at 60-80px
 *     blur radii plus a `background-position` keyframe on a fullscreen
 *     grid layer. That pegged the GPU on weaker devices and caused the
 *     "lag" reported on the public pages — the entire viewport had to
 *     repaint/composite every animation frame.
 *
 *   - This rewrite keeps the brand vibe (aurora glow + faint grid)
 *     but: drops to TWO blobs, halves the blur radius, removes the
 *     repainting grid pan in favor of a static grid, and adds
 *     `will-change: transform` so the browser can keep each blob on
 *     its own GPU layer. The grid is a static SVG-style background —
 *     no animation, no per-frame paint.
 *
 *   - Honors `prefers-reduced-motion`: the blobs hold a static pose
 *     for users who've opted out of motion.
 */
export default function AnimatedBackdrop() {
  return (
    <>
      {/* Keyframes are inlined so this component is drop-in. */}
      <style>{`
        @keyframes afw-aurora-a {
          0%   { transform: translate3d(-6%, -4%, 0) scale(1); }
          50%  { transform: translate3d(4%,  2%, 0) scale(1.05); }
          100% { transform: translate3d(-6%, -4%, 0) scale(1); }
        }
        @keyframes afw-aurora-b {
          0%   { transform: translate3d(3%,  6%, 0) scale(1); }
          50%  { transform: translate3d(-4%, -2%, 0) scale(1.04); }
          100% { transform: translate3d(3%,  6%, 0) scale(1); }
        }
        @keyframes afw-fade-up {
          0%   { opacity: 0; transform: translateY(12px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes afw-pulse-ring {
          0%   { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.55); }
          70%  { box-shadow: 0 0 0 18px rgba(16, 185, 129, 0); }
          100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
        .afw-animate-fade-up { animation: afw-fade-up 0.7s ease-out both; }
        .afw-animate-fade-up-delay-1 { animation: afw-fade-up 0.7s ease-out 0.1s both; }
        .afw-animate-fade-up-delay-2 { animation: afw-fade-up 0.7s ease-out 0.2s both; }
        .afw-animate-fade-up-delay-3 { animation: afw-fade-up 0.7s ease-out 0.3s both; }
        .afw-animate-pulse-ring { animation: afw-pulse-ring 2.4s ease-out infinite; }

        @media (prefers-reduced-motion: reduce) {
          .afw-aurora,
          .afw-animate-pulse-ring,
          .afw-animate-fade-up,
          .afw-animate-fade-up-delay-1,
          .afw-animate-fade-up-delay-2,
          .afw-animate-fade-up-delay-3 {
            animation: none !important;
          }
        }
      `}</style>

      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
        style={{
          backgroundColor: "#05070d",
          backgroundImage:
            "radial-gradient(ellipse at top, rgba(16, 185, 129, 0.08), transparent 55%), radial-gradient(ellipse at bottom, rgba(6, 182, 212, 0.06), transparent 55%)",
        }}
      >
        {/* Static grid overlay — no animation = no per-frame paint. */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(148, 163, 184, 0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.5) 1px, transparent 1px)",
            backgroundSize: "80px 80px",
          }}
        />

        {/* Aurora A (emerald) — half the blur, smaller footprint, GPU-promoted. */}
        <div
          className="afw-aurora absolute"
          style={{
            top: "-15%",
            left: "-10%",
            width: "36rem",
            height: "36rem",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(16, 185, 129, 0.32) 0%, rgba(16, 185, 129, 0) 60%)",
            filter: "blur(40px)",
            opacity: 0.65,
            willChange: "transform",
            animation: "afw-aurora-a 22s ease-in-out infinite",
          }}
        />

        {/* Aurora B (cyan) */}
        <div
          className="afw-aurora absolute"
          style={{
            bottom: "-20%",
            right: "-12%",
            width: "32rem",
            height: "32rem",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(6, 182, 212, 0.28) 0%, rgba(6, 182, 212, 0) 60%)",
            filter: "blur(40px)",
            opacity: 0.6,
            willChange: "transform",
            animation: "afw-aurora-b 26s ease-in-out infinite",
          }}
        />

        {/* Vignette — purely decorative, no animation. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.45) 100%)",
          }}
        />
      </div>
    </>
  );
}
