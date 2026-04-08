/**
 * AnimatedBackdrop — the AI Firewall brand background.
 *
 * - Dark slate base
 * - Two drifting emerald/cyan aurora blobs (CSS keyframe animations)
 * - Subtle noise grain overlay for depth
 * - A faint grid for the "firewall / grid" vibe
 *
 * Used as a fixed-position backdrop on pre-auth pages (Landing, Login,
 * Register) so they all feel like one cohesive product surface.
 */
export default function AnimatedBackdrop() {
  return (
    <>
      {/* Keyframes are inlined so this component is drop-in. */}
      <style>{`
        @keyframes afw-aurora-a {
          0%   { transform: translate3d(-10%, -10%, 0) scale(1);   opacity: 0.55; }
          50%  { transform: translate3d(10%,  5%,  0) scale(1.15); opacity: 0.75; }
          100% { transform: translate3d(-10%, -10%, 0) scale(1);   opacity: 0.55; }
        }
        @keyframes afw-aurora-b {
          0%   { transform: translate3d(5%,  15%, 0) scale(1);    opacity: 0.45; }
          50%  { transform: translate3d(-8%, -5%, 0) scale(1.1);  opacity: 0.7;  }
          100% { transform: translate3d(5%,  15%, 0) scale(1);    opacity: 0.45; }
        }
        @keyframes afw-aurora-c {
          0%   { transform: translate3d(0, 0, 0) scale(1);       opacity: 0.3; }
          50%  { transform: translate3d(12%, -12%, 0) scale(1.2); opacity: 0.55; }
          100% { transform: translate3d(0, 0, 0) scale(1);       opacity: 0.3; }
        }
        @keyframes afw-grid-pan {
          0%   { background-position: 0px 0px; }
          100% { background-position: 80px 80px; }
        }
        @keyframes afw-fade-up {
          0%   { opacity: 0; transform: translateY(12px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes afw-pulse-ring {
          0%   { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.55); }
          70%  { box-shadow: 0 0 0 18px rgba(16, 185, 129, 0);  }
          100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);     }
        }
        .afw-animate-fade-up { animation: afw-fade-up 0.7s ease-out both; }
        .afw-animate-fade-up-delay-1 { animation: afw-fade-up 0.7s ease-out 0.1s both; }
        .afw-animate-fade-up-delay-2 { animation: afw-fade-up 0.7s ease-out 0.2s both; }
        .afw-animate-fade-up-delay-3 { animation: afw-fade-up 0.7s ease-out 0.3s both; }
        .afw-animate-pulse-ring { animation: afw-pulse-ring 2.4s ease-out infinite; }
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
        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(148, 163, 184, 0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.5) 1px, transparent 1px)",
            backgroundSize: "80px 80px",
            animation: "afw-grid-pan 30s linear infinite",
          }}
        />

        {/* Aurora blob A (emerald) */}
        <div
          className="absolute"
          style={{
            top: "-20%",
            left: "-10%",
            width: "60rem",
            height: "60rem",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(16, 185, 129, 0.35) 0%, rgba(16, 185, 129, 0) 60%)",
            filter: "blur(60px)",
            animation: "afw-aurora-a 18s ease-in-out infinite",
          }}
        />

        {/* Aurora blob B (cyan) */}
        <div
          className="absolute"
          style={{
            bottom: "-25%",
            right: "-15%",
            width: "55rem",
            height: "55rem",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(6, 182, 212, 0.3) 0%, rgba(6, 182, 212, 0) 60%)",
            filter: "blur(70px)",
            animation: "afw-aurora-b 22s ease-in-out infinite",
          }}
        />

        {/* Aurora blob C (violet accent) */}
        <div
          className="absolute"
          style={{
            top: "35%",
            left: "45%",
            width: "40rem",
            height: "40rem",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(139, 92, 246, 0.18) 0%, rgba(139, 92, 246, 0) 60%)",
            filter: "blur(80px)",
            animation: "afw-aurora-c 25s ease-in-out infinite",
          }}
        />

        {/* Vignette */}
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
