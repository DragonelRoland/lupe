"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GridBackground from "@/components/canvas/GridBackground";
import Element from "@/components/canvas/Element";
import type { CanvasElement, ViewState } from "@/components/canvas/types";

const MIN_ZOOM = 0.05; // base floor; dynamic min can go lower based on viewport/world size
const MAX_ZOOM = 8;
const WHEEL_ZOOM_SENSITIVITY = 0.01;

type Props = {
  elements: CanvasElement[];
  initialView?: ViewState;
};

export default function CanvasViewer({ elements, initialView }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>(
    initialView && typeof initialView === "object"
      ? initialView
      : { zoom: 1, pan: { x: 0, y: 0 } }
  );

  const clampPan = useCallback((pan: { x: number; y: number }, zoom: number) => {
    const container = containerRef.current;
    if (!container) return pan;
    const viewportWidthWorld = container.clientWidth / Math.max(zoom, 0.0001);
    const viewportHeightWorld = container.clientHeight / Math.max(zoom, 0.0001);

    const WORLD_MIN_X = -40000;
    const WORLD_MAX_X = 40000;
    const WORLD_MIN_Y = -40000;
    const WORLD_MAX_Y = 40000;

    const worldWidth = WORLD_MAX_X - WORLD_MIN_X;
    const worldHeight = WORLD_MAX_Y - WORLD_MIN_Y;

    const desiredLeft = -pan.x / zoom;
    const desiredTop = -pan.y / zoom;

    const minLeft = WORLD_MIN_X;
    const maxLeft = WORLD_MAX_X - viewportWidthWorld;
    const minTop = WORLD_MIN_Y;
    const maxTop = WORLD_MAX_Y - viewportHeightWorld;

    let clampedLeft: number;
    if (viewportWidthWorld >= worldWidth) {
      clampedLeft = (WORLD_MIN_X + WORLD_MAX_X - viewportWidthWorld) / 2;
    } else {
      clampedLeft = Math.min(Math.max(desiredLeft, minLeft), maxLeft);
    }

    let clampedTop: number;
    if (viewportHeightWorld >= worldHeight) {
      clampedTop = (WORLD_MIN_Y + WORLD_MAX_Y - viewportHeightWorld) / 2;
    } else {
      clampedTop = Math.min(Math.max(desiredTop, minTop), maxTop);
    }

    return { x: -clampedLeft * zoom, y: -clampedTop * zoom };
  }, []);

  const getDynamicMinZoom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return MIN_ZOOM;
    const WORLD_MIN_X = -40000;
    const WORLD_MAX_X = 40000;
    const WORLD_MIN_Y = -40000;
    const WORLD_MAX_Y = 40000;
    const worldWidth = WORLD_MAX_X - WORLD_MIN_X;
    const worldHeight = WORLD_MAX_Y - WORLD_MIN_Y;
    const fitX = container.clientWidth / Math.max(worldWidth, 1);
    const fitY = container.clientHeight / Math.max(worldHeight, 1);
    const fitMin = Math.min(fitX, fitY);
    return Math.max(Math.min(MIN_ZOOM, fitMin), 0.005);
  }, []);

  const applyZoom = useCallback((nextZoom: number, originX?: number, originY?: number) => {
    setView((prev) => {
      const minZoom = getDynamicMinZoom();
      const newZoom = Math.max(minZoom, Math.min(MAX_ZOOM, nextZoom));
      if (!containerRef.current) return { ...prev, zoom: newZoom };
      const rect = containerRef.current.getBoundingClientRect();
      const cx = (originX ?? rect.left + rect.width / 2) - rect.left;
      const cy = (originY ?? rect.top + rect.height / 2) - rect.top;
      const ratio = newZoom / prev.zoom;
      const nextPan = { x: cx - (cx - prev.pan.x) * ratio, y: cy - (cy - prev.pan.y) * ratio };
      const clamped = clampPan(nextPan, newZoom);
      return { zoom: newZoom, pan: clamped };
    });
  }, [clampPan, getDynamicMinZoom]);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        applyZoom(view.zoom * factor, e.clientX, e.clientY);
        return;
      }
      setView((prev) => {
        const nextPan = { x: prev.pan.x - e.deltaX, y: prev.pan.y - e.deltaY };
        return { ...prev, pan: clampPan(nextPan, prev.zoom) };
      });
    },
    [applyZoom, view.zoom, clampPan]
  );

  const stageStyle = useMemo<React.CSSProperties>(() => ({
    transform: `translate3d(${view.pan.x}px, ${view.pan.y}px, 0) scale(${view.zoom})`,
    transformOrigin: "0 0",
    willChange: "transform",
  }), [view.pan.x, view.pan.y, view.zoom]);

  // Keep initialView in sync if it changes (rare)
  useEffect(() => {
    if (!initialView) return;
    setView(initialView);
  }, [initialView]);

  return (
    <div
      ref={containerRef}
      className="relative h-screen w-screen overflow-hidden select-none"
      onWheel={onWheel}
      tabIndex={0}
      style={{ touchAction: "none", overscrollBehavior: "none" }}
    >
      <GridBackground zoom={view.zoom} pan={view.pan} />
      <div className="absolute inset-0" style={stageStyle}>
        {elements
          .slice()
          .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
          .map((el) => (
            <Element
              key={el.id}
              element={el}
              zoom={view.zoom}
              selected={false}
              readOnly
              onSelect={() => {}}
              onMove={() => {}}
            />
          ))}
      </div>
    </div>
  );
}
