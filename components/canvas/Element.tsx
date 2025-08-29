"use client";

import type { CanvasElement } from "@/components/canvas/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import SparkleBurst from "@/components/ui/SparkleBurst";

type Props = {
  element: CanvasElement;
  zoom: number;
  onMove: (id: string, next: { x: number; y: number }) => void;
  onDragStart?: (id: string) => void;
  onDragEnd?: (id: string) => void;
  onResize?: (
    id: string,
    next: { position: { x: number; y: number }; size: { width: number; height: number }; fontSize?: number }
  ) => void;
  onEditText?: (id: string, text: string) => void;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onImageTapped?: (id: string, info: { url: string; width: number; height: number }) => void;
  onVideoToggle?: (id: string, shouldPlay: boolean) => void;
  readOnly?: boolean;
};

export default function Element({ element, zoom, onMove, onDragStart, onDragEnd, onResize, onEditText, selected, onSelect, onImageTapped, onVideoToggle, readOnly }: Props) {
  const { type, position, size, imageUrl, videoUrl, text, fontSize } = element;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const draggingRef = useRef(false);
  const startPointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const startPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const movedBeyondClickThresholdRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const wasSelectedOnPointerDownRef = useRef(false);

  // Resize handling
  const resizingRef = useRef(false);
  const resizeDirRef = useRef<
    "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | null
  >(null);
  const startSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const startFontSizeRef = useRef<number>(fontSize ?? 32);

  const onTogglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const willPlay = v.paused;
    // Broadcast intended state so other selected videos sync
    onVideoToggle?.(element.id, willPlay);
    if (willPlay) {
      void v.play();
    } else {
      v.pause();
    }
  }, [element.id, onVideoToggle]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
    if (isEditing) return; // when editing text, do not start drag
    if (e.button !== 0) return; // left click only for dragging
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setIsDragging(true);
    startPointer.current = { x: e.clientX, y: e.clientY };
    startPos.current = { ...position };
    movedBeyondClickThresholdRef.current = false;
    wasSelectedOnPointerDownRef.current = !!selected;
    // Ensure selection updates before drag snapshotting
    // For videos: do not collapse multi-selection when clicking an already-selected element
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (type === "video") {
      if (!selected || additive) onSelect?.(element.id);
    } else {
      onSelect?.(element.id);
    }
    onDragStart?.(element.id);
  }, [element.id, onDragStart, position, readOnly, isEditing, selected]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
    if (!draggingRef.current) return;
    const dxScreen = e.clientX - startPointer.current.x;
    const dyScreen = e.clientY - startPointer.current.y;
    if (!movedBeyondClickThresholdRef.current) {
      const distSq = dxScreen * dxScreen + dyScreen * dyScreen;
      if (distSq > 16) movedBeyondClickThresholdRef.current = true; // >4px
    }
    const dx = dxScreen / Math.max(zoom, 0.0001);
    const dy = dyScreen / Math.max(zoom, 0.0001);
    onMove(element.id, { x: Math.round(startPos.current.x + dx), y: Math.round(startPos.current.y + dy) });
  }, [element.id, onMove, zoom, readOnly]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    onDragEnd?.(element.id);
    // Treat as a tap if we did not move more than threshold
    if (!movedBeyondClickThresholdRef.current) {
      if (type === "image" && imageUrl && onImageTapped) {
        onImageTapped(element.id, { url: imageUrl, width: size.width, height: size.height });
      }
      if (type === "text") {
        if (wasSelectedOnPointerDownRef.current) {
          try { textRef.current?.focus(); } catch {}
          setIsEditing(true);
        }
        // If it was not previously selected, this click just selected it; do not focus yet
      }
      if (type === "video") {
        // Restore click-anywhere-to-toggle for selected videos
        if (wasSelectedOnPointerDownRef.current) onTogglePlay();
      }
    }
  }, [readOnly, onDragEnd, element.id, type, imageUrl, onImageTapped, size.width, size.height, onTogglePlay]);

  const onPointerCancel = useCallback(() => {
    if (readOnly) return;
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
  }, [readOnly]);

  const onLostPointerCapture = useCallback(() => {
    if (readOnly) return;
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
  }, [readOnly]);

  // While dragging, also listen on window to avoid relying solely on pointer capture
  useEffect(() => {
    if (!isDragging) return;
    const handleWindowPointerMove = (e: PointerEvent) => {
      const dxScreen = e.clientX - startPointer.current.x;
      const dyScreen = e.clientY - startPointer.current.y;
      const dx = dxScreen / Math.max(zoom, 0.0001);
      const dy = dyScreen / Math.max(zoom, 0.0001);
      onMove(element.id, { x: Math.round(startPos.current.x + dx), y: Math.round(startPos.current.y + dy) });
    };
    const handleWindowPointerUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        setIsDragging(false);
      }
    };
    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
    };
  }, [isDragging, zoom, element.id, onMove]);

  // Listen to trusted user-initiated play/pause on the video controls and broadcast
  useEffect(() => {
    if (type !== "video") return;
    const v = videoRef.current;
    if (!v) return;
    const handlePlay = (e: Event) => {
      // Only broadcast for trusted user actions to avoid loops
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((e as any).isTrusted) onVideoToggle?.(element.id, true);
    };
    const handlePause = (e: Event) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((e as any).isTrusted) onVideoToggle?.(element.id, false);
    };
    v.addEventListener("play", handlePlay);
    v.addEventListener("pause", handlePause);
    return () => {
      v.removeEventListener("play", handlePlay);
      v.removeEventListener("pause", handlePause);
    };
  }, [type, element.id, onVideoToggle]);

  // Focus text box only when explicitly requested via event (new element) or second click logic above

  useEffect(() => {
    const handler = (e: Event) => {
      const { id } = (e as CustomEvent).detail || {};
      if (id === element.id && type === "text" && !readOnly) {
        try { textRef.current?.focus(); } catch {}
      }
    };
    window.addEventListener("lupe:focus-text", handler as EventListener);
    return () => window.removeEventListener("lupe:focus-text", handler as EventListener);
  }, [element.id, type, readOnly]);

  // Keep contentEditable in sync when not actively editing
  useEffect(() => {
    if (type !== "text") return;
    const el = textRef.current;
    if (!el) return;
    if (isEditing) return;
    const val = text ?? "";
    if (el.textContent !== val) el.textContent = val;
  }, [text, type, isEditing]);

  // Resize helpers
  const onResizePointerDown = useCallback((dir: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw", e: React.PointerEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizingRef.current = true;
    resizeDirRef.current = dir;
    startPointer.current = { x: e.clientX, y: e.clientY };
    startPos.current = { ...position };
    startSizeRef.current = { width: size.width, height: size.height };
    startFontSizeRef.current = fontSize ?? 32;
    onSelect?.(element.id);
  }, [readOnly, position, size.width, size.height, fontSize, element.id, onSelect]);

  useEffect(() => {
    if (!resizingRef.current) return;
    const handleMove = (e: PointerEvent) => {
      const dir = resizeDirRef.current;
      if (!dir) return;
      const dxScreen = e.clientX - startPointer.current.x;
      const dyScreen = e.clientY - startPointer.current.y;
      const dx = dxScreen / Math.max(zoom, 0.0001);
      const dy = dyScreen / Math.max(zoom, 0.0001);

      const minW = 60;
      const minH = 40;

      let newX = startPos.current.x;
      let newY = startPos.current.y;
      let newW = startSizeRef.current.width;
      let newH = startSizeRef.current.height;

      const isCorner = dir.length === 2;
      if (isCorner) {
        // Constrain to perfect 45° diagonal for corner drags
        let deltaDiag = 0;
        if (dir === "se") deltaDiag = (dx + dy) / 2;
        else if (dir === "ne") deltaDiag = (dx - dy) / 2;
        else if (dir === "sw") deltaDiag = (dy - dx) / 2;
        else if (dir === "nw") deltaDiag = (-(dx + dy)) / 2;

        // Enforce min size
        const minDelta = Math.max(minW - startSizeRef.current.width, minH - startSizeRef.current.height);
        const clamped = Math.max(deltaDiag, minDelta);

        const targetW = startSizeRef.current.width + clamped;
        const targetH = startSizeRef.current.height + clamped;

        // Apply and adjust position depending on handle
        newW = Math.max(minW, Math.round(targetW));
        newH = Math.max(minH, Math.round(targetH));
        if (dir === "ne" || dir === "nw") {
          newY = Math.round(startPos.current.y - (newH - startSizeRef.current.height));
        }
        if (dir === "sw" || dir === "nw") {
          newX = Math.round(startPos.current.x - (newW - startSizeRef.current.width));
        }
      } else {
        // Edge-only resize: width or height independently, no font scaling
        if (dir.includes("e")) newW = Math.max(minW, Math.round(startSizeRef.current.width + dx));
        if (dir.includes("s")) newH = Math.max(minH, Math.round(startSizeRef.current.height + dy));
        if (dir.includes("w")) {
          newW = Math.max(minW, Math.round(startSizeRef.current.width - dx));
          newX = Math.round(startPos.current.x + Math.min(startSizeRef.current.width - minW, dx));
        }
        if (dir.includes("n")) {
          newH = Math.max(minH, Math.round(startSizeRef.current.height - dy));
          newY = Math.round(startPos.current.y + Math.min(startSizeRef.current.height - minH, dy));
        }
      }

      let nextFontSize: number | undefined = undefined;
      if (type === "text" && isCorner) {
        const h0 = Math.max(1, startSizeRef.current.height);
        const scale = newH / h0; // equal to newW / w0 when constrained
        nextFontSize = Math.max(6, Math.round((startFontSizeRef.current || 32) * scale));
      }

      if (onResize) onResize(element.id, { position: { x: newX, y: newY }, size: { width: newW, height: newH }, fontSize: nextFontSize });
    };
    const handleUp = () => {
      resizingRef.current = false;
      resizeDirRef.current = null;
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [zoom, onResize, element.id, type]);

  return (
    <div
      data-element-id={element.id}
      className={`absolute ${readOnly ? "cursor-default" : (isDragging ? "cursor-grabbing" : "cursor-grab")} ${selected ? "ring-2 ring-sky-400" : "ring-1 ring-white/10"}`}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        touchAction: "none",
        transition: element.animateMove ? "left 450ms ease, top 450ms ease" : undefined,
      }}
      draggable={false}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
    >
      {type === "text" ? (
        <div
          className={`absolute inset-0 pointer-events-none ${selected ? "border-2 border-white/90" : "border border-white/40"}`}
        />
      ) : null}
      {type === "image" && imageUrl ? (
        <img
          src={imageUrl}
          draggable={false}
          className="h-full w-full select-none rounded-md object-contain shadow-sm"
          alt=""
        />
      ) : null}
      {type === "video" && videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          className="h-full w-full rounded-md object-contain shadow-sm"
          draggable={false}
          muted
          loop
          playsInline
          controls
        />
      ) : null}
      
      {/* Solid black placeholder frame for generating assets */}
      {element.isGenerating && !imageUrl && type === "image" ? (
        <div className="relative h-full w-full rounded-md bg-neutral-950 border border-white/20 overflow-hidden">
          <SparkleBurst 
            seed={element.id} 
            count={Math.max(6, Math.min(16, Math.round(Math.sqrt((size.width * size.height) / 12000))))} 
          />
        </div>
      ) : null}
      {element.isGenerating && !videoUrl && type === "video" ? (
        <div className="relative h-full w-full rounded-md bg-neutral-950 border border-white/20 overflow-hidden">
          <SparkleBurst 
            seed={element.id} 
            count={Math.max(6, Math.min(16, Math.round(Math.sqrt((size.width * size.height) / 12000))))} 
          />
        </div>
      ) : null}

      {/* Prompt display when selected */}
      {selected && element.prompt && (type === "image" || type === "video") ? (
        <div
          className="absolute group max-w-full"
          style={{
            bottom: -8,
            left: 0,
            right: 0,
            transform: "translateY(100%)",
            zIndex: 10,
          }}
        >
          <div className="text-4xl text-neutral-300 bg-neutral-900/80 px-3 py-2 rounded-md shadow-sm pointer-events-none break-words">
            {element.prompt}
          </div>
          <button
            className="mt-1 opacity-70 hover:opacity-100 transition-opacity duration-200 flex items-center gap-3 text-lg text-neutral-400 hover:text-neutral-200 bg-neutral-800/90 hover:bg-neutral-700/90 px-6 py-3 rounded-lg border border-neutral-600/50 hover:border-neutral-500 pointer-events-auto"
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
            }}
            onClick={async (e) => {
              e.stopPropagation();
              e.preventDefault();
              try {
                await navigator.clipboard.writeText(element.prompt || "");
              } catch (err) {
                // Fallback for older browsers
                const textArea = document.createElement("textarea");
                textArea.value = element.prompt || "";
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand("copy");
                document.body.removeChild(textArea);
              }
            }}
            title="Copy prompt"
          >
            <Copy className="h-6 w-6" />
            Copy
          </button>
        </div>
      ) : null}
      {type === "text" ? (
        <div 
          className={`h-full w-full rounded-md shadow-sm ${
            element.error 
              ? "bg-red-900/70 ring-1 ring-red-500/30" 
              : "bg-transparent"
          }`} 
          style={{ overflow: "hidden" }}
        >
          <div
            ref={textRef}
            contentEditable={!readOnly && !element.error}
            suppressContentEditableWarning
            className={`h-full w-full outline-none ${
              element.error ? "text-red-100" : "text-white"
            }`}
            style={{
              padding: 8,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: (fontSize ?? 32),
              lineHeight: 1.25,
            }}
            onPointerDown={(e) => {
              if (isEditing || element.error) {
                e.stopPropagation();
                return;
              }
              // When not editing, prevent focusing the contenteditable so dragging can start
              e.preventDefault();
              // Do not stopPropagation so the outer element's onPointerDown handles drag
            }}
            onDoubleClick={(e) => { 
              if (element.error) return;
              e.stopPropagation(); 
              try { textRef.current?.focus(); } catch {} 
              setIsEditing(true); 
            }}
            onFocus={() => !element.error && setIsEditing(true)}
            onBlur={() => setIsEditing(false)}
            onInput={(e) => {
              if (readOnly || element.error) return;
              const value = (e.currentTarget.textContent ?? "");
              onEditText?.(element.id, value);
            }}
          >
            {element.error && element.text && (
              <span className="inline-flex items-center gap-1">
                <span className="text-red-300">❌</span>
                {element.text}
              </span>
            )}
          </div>
        </div>
      ) : null}

      {!readOnly && selected && type === "text" && !element.error ? (
        <>
          {/* corners */}
          <div onPointerDown={(e) => onResizePointerDown("nw", e)} className="absolute -top-3 -left-3 z-20 h-5 w-5 rounded bg-white border-2 border-black shadow-lg" style={{ cursor: "nwse-resize" }} />
          <div onPointerDown={(e) => onResizePointerDown("ne", e)} className="absolute -top-3 -right-3 z-20 h-5 w-5 rounded bg-white border-2 border-black shadow-lg" style={{ cursor: "nesw-resize" }} />
          <div onPointerDown={(e) => onResizePointerDown("sw", e)} className="absolute -bottom-3 -left-3 z-20 h-5 w-5 rounded bg-white border-2 border-black shadow-lg" style={{ cursor: "nesw-resize" }} />
          <div onPointerDown={(e) => onResizePointerDown("se", e)} className="absolute -bottom-3 -right-3 z-20 h-5 w-5 rounded bg-white border-2 border-black shadow-lg" style={{ cursor: "nwse-resize" }} />
          {/* edges */}
          <div onPointerDown={(e) => onResizePointerDown("n", e)} className="absolute -top-2 left-0 right-0 z-20 h-5 bg-transparent" style={{ cursor: "ns-resize" }} />
          <div onPointerDown={(e) => onResizePointerDown("s", e)} className="absolute -bottom-2 left-0 right-0 z-20 h-5 bg-transparent" style={{ cursor: "ns-resize" }} />
          <div onPointerDown={(e) => onResizePointerDown("w", e)} className="absolute -left-2 top-0 bottom-0 z-20 w-5 bg-transparent" style={{ cursor: "ew-resize" }} />
          <div onPointerDown={(e) => onResizePointerDown("e", e)} className="absolute -right-2 top-0 bottom-0 z-20 w-5 bg-transparent" style={{ cursor: "ew-resize" }} />
        </>
      ) : null}
    </div>
  );
}
