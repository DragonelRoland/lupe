"use client";

import React, { useMemo } from "react";

type SparkleBurstProps = {
  count?: number;
  seed?: string;
};

export default function SparkleBurst({ count = 8, seed = "0" }: SparkleBurstProps) {
  // Simple deterministic RNG from seed
  const rand = (function mk(seedStr: string) {
    let s = 0;
    for (let i = 0; i < seedStr.length; i++) s = (s * 31 + seedStr.charCodeAt(i)) >>> 0;
    return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff;
  })(seed);

  const stars = useMemo(() => {
    return Array.from({ length: count }).map((_, i) => {
      const x = Math.floor(rand() * 100);
      const y = Math.floor(rand() * 100);
      const base = rand();
      const size = 15 + Math.round(base * base * 50); // 15px..65px, weighted to smaller
      const dur = 0.9 + rand() * 0.9; // 0.9s..1.8s
      const delay = -(rand() * dur); // stagger immediately
      return { x, y, size, dur, delay, key: `s-${i}` };
    });
  }, [seed, count]);

  return (
    <div className="relative w-full h-full pointer-events-none">
      {stars.map(({ x, y, size, dur, delay, key }) => (
        <svg
          key={key}
          viewBox="0 0 100 100"
          style={{
            position: "absolute",
            left: `${x}%`,
            top: `${y}%`,
            width: `${size}px`,
            height: `${size}px`,
            marginLeft: `-${size / 2}px`,
            marginTop: `-${size / 2}px`,
            animation: `sparkleTwinkle ${dur}s ease-in-out ${delay}s infinite`,
            filter: "drop-shadow(0 0 6px rgba(255,255,255,0.6))",
          }}
        >
          <path d="M50 0 L62 38 L100 50 L62 62 L50 100 L38 62 L0 50 L38 38 Z" fill="#ffffff" />
        </svg>
      ))}
    </div>
  );
}


