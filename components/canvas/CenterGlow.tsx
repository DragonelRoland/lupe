"use client";

// Screen-space vignette/glow that subtly brightens the center and darkens edges.
// Placed above the grid but below the element stage so it doesn't tint content.
export default function CenterGlow() {
  const style: React.CSSProperties = {
    pointerEvents: "none",
    backgroundImage: `
      radial-gradient(60% 60% at 50% 50%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 40%, rgba(0,0,0,0) 65%),
      radial-gradient(80% 80% at 50% 50%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.22) 100%)
    `,
    backgroundBlendMode: "screen, multiply",
  };

  return <div className="absolute inset-0 z-0" style={style} />;
}
