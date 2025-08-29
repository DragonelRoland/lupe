"use client";

import { memo } from "react";

type Props = {
  zoom: number;
  pan?: { x: number; y: number };
};

// Dark, subtle grid inspired by the provided design.
// Keeps line thickness visually ~1px by adjusting background-size with zoom.
function GridBackgroundImpl({ zoom, pan }: Props) {
  // Base spacing in CSS pixels at zoom=1
  const minor = 32;
  const major = minor * 5;

  // Make the grid less dense when zoomed out by adding a baseline spacing
  // so squares never become too tiny, while still responding smoothly to zoom.
  // Example: with BASELINE=12, minor spacing is 12px at zoom≈0 and grows linearly.
  const BASELINE = 32; // pixels added to minor spacing regardless of zoom
  const minorPx = BASELINE + minor * zoom;
  const majorPx = (minorPx / minor) * major; // preserve 5x relationship

  // Offset the grid by the current pan so lines remain anchored in world space
  const px = pan?.x ?? 0;
  const py = pan?.y ?? 0;
  const mod = (v: number, m: number) => ((v % m) + m) % m;
  const offMinorX = mod(px, minorPx);
  const offMinorY = mod(py, minorPx);
  const offMajorX = mod(px, majorPx);
  const offMajorY = mod(py, majorPx);

  const style: React.CSSProperties = {
    backgroundColor: "rgb(10,10,10)",
    backgroundImage: `
      linear-gradient(to right, rgba(255,255,255,0.045) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255,255,255,0.045) 1px, transparent 1px),
      linear-gradient(to right, rgba(255,255,255,0.07) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255,255,255,0.07) 1px, transparent 1px)
    `,
    backgroundSize: `${minorPx}px ${minorPx}px, ${minorPx}px ${minorPx}px, ${majorPx}px ${majorPx}px, ${majorPx}px ${majorPx}px`,
    backgroundPosition: `${offMinorX}px ${offMinorY}px, ${offMinorX}px ${offMinorY}px, ${offMajorX}px ${offMajorY}px, ${offMajorX}px ${offMajorY}px`,
  };

  return <div className="absolute inset-0" style={style} />;
}

const GridBackground = memo(GridBackgroundImpl);
export default GridBackground;
