"use client";

import { useEffect } from "react";

export default function NoPageZoom() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      // Prevent browser-level zoom on ctrl/cmd + trackpad pinch
      if (e.ctrlKey || (e as any).metaKey) {
        e.preventDefault();
      }
    };

    // Safari-specific gesture events for pinch zoom
    const onGesture = (e: Event) => {
      e.preventDefault();
    };

    // Capture early to prevent default page zoom while still allowing the
    // event to propagate to React handlers for the canvas.
    document.addEventListener("wheel", onWheel, { passive: false, capture: true });
    document.addEventListener("gesturestart", onGesture as EventListener, { passive: false, capture: true } as any);
    document.addEventListener("gesturechange", onGesture as EventListener, { passive: false, capture: true } as any);
    document.addEventListener("gestureend", onGesture as EventListener, { passive: false, capture: true } as any);

    return () => {
      document.removeEventListener("wheel", onWheel, true);
      document.removeEventListener("gesturestart", onGesture as EventListener, true as any);
      document.removeEventListener("gesturechange", onGesture as EventListener, true as any);
      document.removeEventListener("gestureend", onGesture as EventListener, true as any);
    };
  }, []);

  return null;
}


