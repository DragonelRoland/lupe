"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GridBackground from "@/components/canvas/GridBackground";
import Controls from "@/components/canvas/Controls";
import type { CanvasElement, ViewState } from "@/components/canvas/types";
import Element from "@/components/canvas/Element";
import { deleteBlob, getBlob, loadElementsMetadata, putBlob, saveElementsMetadata } from "@/components/canvas/storage";
import { useAuth } from "@/lib/auth-context";
import { useCanvasDocument } from "@/lib/hooks/useCanvasDocument";
import { uploadAssetAndGetPublicUrl } from "@/lib/storage/assets";

const MIN_ZOOM = 0.05; // base floor; dynamic min can go lower based on viewport/world size
const MAX_ZOOM = 8;
// Lower values => less sensitive zoom on trackpads
const WHEEL_ZOOM_SENSITIVITY = 0.01; // exponential coefficient for ctrl/cmd + wheel
const SAFARI_GESTURE_SENSITIVITY = 0.55; // scales (e.scale - 1) by this factor
// Generous world bounds in canvas/world units (before zoom)
// Doubled to provide more working space
const WORLD_MIN_X = -40000;
const WORLD_MAX_X = 40000;
const WORLD_MIN_Y = -40000;
const WORLD_MAX_Y = 40000;

export default function Canvas({ docId: docIdProp }: { docId?: string | null } = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [view, setView] = useState<ViewState>({ zoom: 1, pan: { x: 0, y: 0 } });
  const { user } = useAuth();
  const [isSpace, setIsSpace] = useState(false);
  const [panning, setPanning] = useState(false);
  const panStart = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panOrigin = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pickRequest, setPickRequest] = useState<{ requestId: string } | null>(null);
  const [isAdditiveKeyDown, setIsAdditiveKeyDown] = useState(false);
  const [marquee, setMarquee] = useState<{
    isSelecting: boolean;
    start: { x: number; y: number };
    current: { x: number; y: number };
    additive: boolean;
  }>({ isSelecting: false, start: { x: 0, y: 0 }, current: { x: 0, y: 0 }, additive: false });
  const [marqueeHits, setMarqueeHits] = useState<Set<string>>(new Set());
  const gestureBaseZoomRef = useRef<number>(1);
  const [undoStack, setUndoStack] = useState<CanvasElement[]>([]);
  const undoTimersRef = useRef<Record<string, number>>({});
  const UNDO_TTL_MS = 60000;
  const [clipboardElements, setClipboardElements] = useState<CanvasElement[]>([]);
  const groupDragRef = useRef<{ anchorId: string | null; startPositionsById: Record<string, { x: number; y: number }> }>({ anchorId: null, startPositionsById: {} });
  const [suppressSave, setSuppressSave] = useState<boolean>(Boolean(docIdProp));
  const { docId } = useCanvasDocument({ userId: user?.id ?? null, elements, viewState: view, docIdOverride: docIdProp ?? null, suppressSave });
  const uploadingRef = useRef<Set<string>>(new Set());
  const [remoteReady, setRemoteReady] = useState<boolean>(false);
  const currentDocIdRef = useRef<string | null>(null);

  // Handle synchronized video playback for selected videos
  const handleVideoToggle = useCallback((clickedId: string, shouldPlay: boolean) => {
    // Get all currently selected element IDs
    const allSelectedIds = new Set<string>();
    if (selectedId) allSelectedIds.add(selectedId);
    selectedIds.forEach(id => allSelectedIds.add(id));
    
    // Filter to video elements only
    const selectedVideoIds = elements
      .filter(el => el.type === "video" && allSelectedIds.has(el.id))
      .map(el => el.id);
    
    // Control all selected videos (excluding the clicked one since it handles itself)
    selectedVideoIds.forEach(id => {
      if (id === clickedId) return; // Skip the clicked video, it handles itself
      
      const videoElement = stageRef.current?.querySelector(`[data-element-id="${id}"] video`) as HTMLVideoElement;
      if (videoElement) {
        if (shouldPlay) {
          void videoElement.play();
        } else {
          videoElement.pause();
        }
      }
    });
  }, [selectedId, selectedIds, elements]);

  // Arrange selected images and videos into a grid (auto/row/column)
  const arrangeSelectedImages = useCallback((mode?: "auto" | "row" | "column") => {
    setElements((prev) => {
      const selectedSet: Set<string> = selectedIds.size > 0 ? new Set(selectedIds) : (selectedId ? new Set([selectedId]) : new Set());
      if (selectedSet.size < 2) return prev;

      const selection = prev.filter((e) => selectedSet.has(e.id) && (e.type === "image" || e.type === "video"));
      if (selection.length < 2) return prev;

      // Compute anchor at top-left of selection bounds
      let minX = Infinity;
      let minY = Infinity;
      let maxW = 0;
      let maxH = 0;
      for (const el of selection) {
        minX = Math.min(minX, el.position.x);
        minY = Math.min(minY, el.position.y);
        maxW = Math.max(maxW, el.size.width);
        maxH = Math.max(maxH, el.size.height);
      }
      const gap = 16;
      const n = selection.length;
      let cols = n;
      let rows = 1;
      if (mode === "column") {
        cols = 1;
        rows = n;
      } else if (mode === "row") {
        cols = n;
        rows = 1;
      } else {
        cols = Math.max(1, Math.ceil(Math.sqrt(n)));
        rows = Math.max(1, Math.ceil(n / cols));
      }

      // Assign positions in row-major order, keep order stable by current z ascending
      const idsInOrder = selection
        .slice()
        .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
        .map((e) => e.id);

      const idToTarget: Record<string, { x: number; y: number }> = {};
      for (let i = 0; i < idsInOrder.length; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const x = Math.round(minX + col * (maxW + gap));
        const y = Math.round(minY + row * (maxH + gap));
        idToTarget[idsInOrder[i]!] = { x, y };
      }

      const topZ = Math.max(0, ...prev.map((e) => e.z ?? 0)) + 1;
      let inc = 0;
      const next = prev.map((e) => {
        const t = idToTarget[e.id];
        if (!t) return e;
        const z = topZ + inc++;
        return { ...e, position: t, animateMove: true, z } as CanvasElement;
      });

      // Clear animate flag after transition
      window.setTimeout(() => {
        setElements((curr) => curr.map((p) => (idToTarget[p.id] ? { ...p, animateMove: false } : p)));
      }, 450);

      return next;
    });
  }, [selectedId, selectedIds]);

  // Detect touch/coarse pointer devices once
  const isTouchLikeDevice = useMemo(() => {
    try {
      const hasTouchPoints = typeof navigator !== "undefined" && (navigator as any).maxTouchPoints > 0;
      const coarse = typeof window !== "undefined" && !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
      return hasTouchPoints || coarse;
    } catch {
      return false;
    }
  }, []);

  // Clamp pan so the viewport remains within WORLD bounds
  const clampPan = useCallback((pan: { x: number; y: number }, zoom: number) => {
    const container = containerRef.current;
    if (!container) return pan;
    const viewportWidthWorld = container.clientWidth / Math.max(zoom, 0.0001);
    const viewportHeightWorld = container.clientHeight / Math.max(zoom, 0.0001);

    const worldWidth = WORLD_MAX_X - WORLD_MIN_X;
    const worldHeight = WORLD_MAX_Y - WORLD_MIN_Y;

    // Desired top-left in world units for this pan
    const desiredLeft = -pan.x / zoom;
    const desiredTop = -pan.y / zoom;

    // Compute allowed ranges. If viewport is larger than world, center it.
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

  const onReset = useCallback(() => {
    setView({ zoom: 1, pan: { x: 0, y: 0 } });
  }, []);

  const getDynamicMinZoom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return MIN_ZOOM;
    const worldWidth = WORLD_MAX_X - WORLD_MIN_X;
    const worldHeight = WORLD_MAX_Y - WORLD_MIN_Y;
    const fitX = container.clientWidth / Math.max(worldWidth, 1);
    const fitY = container.clientHeight / Math.max(worldHeight, 1);
    const fitMin = Math.min(fitX, fitY);
    // Allow zooming out to at least fit the entire world, but not below a tiny safe floor
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
      return {
        zoom: newZoom,
        pan: clamped,
      };
    });
  }, [clampPan, getDynamicMinZoom]);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      // Prevent browser native horizontal swipe/back-navigation and scroll chaining
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        // Use a smooth exponential mapping from deltaY to zoom factor.
        // Positive deltaY -> zoom out; negative -> zoom in.
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
        applyZoom(view.zoom * factor, e.clientX, e.clientY);
        return;
      }
      // Smooth pan with wheel (both axes)
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

  const toCanvasCoords = useCallback((screenX: number, screenY: number) => {
    return {
      x: (screenX - view.pan.x) / view.zoom,
      y: (screenY - view.pan.y) / view.zoom,
    };
  }, [view.pan.x, view.pan.y, view.zoom]);

  // Safari pinch-to-zoom support using non-standard gesture events.
  // We handle these on the container so pinch zoom affects only the canvas.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onGestureStart = (e: any) => {
      e.preventDefault();
      gestureBaseZoomRef.current = view.zoom;
    };
    const onGestureChange = (e: any) => {
      e.preventDefault();
      const scale = typeof e.scale === "number" ? e.scale : 1;
      const adjusted = 1 + (scale - 1) * SAFARI_GESTURE_SENSITIVITY;
      applyZoom(gestureBaseZoomRef.current * adjusted, e.clientX, e.clientY);
    };
    const onGestureEnd = (e: any) => {
      e.preventDefault();
    };

    el.addEventListener("gesturestart", onGestureStart as EventListener, { passive: false } as any);
    el.addEventListener("gesturechange", onGestureChange as EventListener, { passive: false } as any);
    el.addEventListener("gestureend", onGestureEnd as EventListener, { passive: false } as any);

    return () => {
      el.removeEventListener("gesturestart", onGestureStart as EventListener);
      el.removeEventListener("gesturechange", onGestureChange as EventListener);
      el.removeEventListener("gestureend", onGestureEnd as EventListener);
    };
  }, [applyZoom, view.zoom]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && target.closest('[data-ui-overlay="true"]')) {
      return;
    }

    // Heuristic: treat coarse pointer devices as touch (some mobile browsers misreport as mouse)
    const isCoarsePointer = (() => {
      try {
        const hasTouchPoints = typeof navigator !== "undefined" && (navigator as any).maxTouchPoints > 0;
        const coarse = typeof window !== "undefined" && !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
        return hasTouchPoints || coarse;
      } catch {
        return false;
      }
    })();

    // Touch/pen, or any coarse pointer: pan the canvas on background
    if (e.pointerType === "touch" || e.pointerType === "pen" || isCoarsePointer) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY };
      panOrigin.current = { ...view.pan };
      return;
    }

    // Mouse: panning when Space is held or middle mouse button
    if (isSpace || e.button === 1) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY };
      panOrigin.current = { ...view.pan };
      return;
    }

    // Mouse: start marquee selection on background left-click (only on fine pointer devices)
    if (e.pointerType === "mouse" && e.button === 0) {
      const start = toCanvasCoords(e.clientX, e.clientY);
      setMarquee({ isSelecting: true, start, current: start, additive: isAdditiveKeyDown });
      setMarqueeHits(new Set());
      if (!isAdditiveKeyDown) {
        setSelectedId(null);
        setSelectedIds(new Set());
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
  }, [isSpace, view.pan, toCanvasCoords, isAdditiveKeyDown]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    // Handle panning
    if (panning) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setView((prev) => ({
        ...prev,
        pan: clampPan({ x: panOrigin.current.x + dx, y: panOrigin.current.y + dy }, prev.zoom),
      }));
    }
    // Handle marquee selection
    if (marquee.isSelecting) {
      const cur = toCanvasCoords(e.clientX, e.clientY);
      setMarquee((prev) => ({ ...prev, current: cur }));
      const x1 = Math.min(marquee.start.x, cur.x);
      const y1 = Math.min(marquee.start.y, cur.y);
      const x2 = Math.max(marquee.start.x, cur.x);
      const y2 = Math.max(marquee.start.y, cur.y);
      const hits = new Set<string>();
      for (const el of elements) {
        if (el.type !== "image" && el.type !== "video" && el.type !== "text") continue;
        const l = el.position.x;
        const t = el.position.y;
        const r = el.position.x + el.size.width;
        const b = el.position.y + el.size.height;
        const intersects = l < x2 && r > x1 && t < y2 && b > y1;
        if (intersects) hits.add(el.id);
      }
      setMarqueeHits(hits);
    }
  }, [panning, clampPan, marquee.isSelecting, marquee.start, toCanvasCoords, elements]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    // End panning
    if (panning) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setPanning(false);
    }
    // Finalize marquee selection
    if (marquee.isSelecting) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
      const finalizeHits = marqueeHits;
      setMarquee({ isSelecting: false, start: { x: 0, y: 0 }, current: { x: 0, y: 0 }, additive: false });
      setMarqueeHits(new Set());
      setSelectedIds((prev) => {
        if (marquee.additive) {
          const next = new Set(prev);
          for (const id of finalizeHits) next.add(id);
          return next;
        }
        return new Set(finalizeHits);
      });
      if (finalizeHits.size > 0) {
        let topId: string | null = null;
        let topZ = -Infinity;
        for (const el of elements) {
          if (finalizeHits.has(el.id)) {
            const z = el.z ?? 0;
            if (z >= topZ) {
              topZ = z;
              topId = el.id;
            }
          }
        }
        setSelectedId(topId);
      } else if (!marquee.additive) {
        setSelectedId(null);
      }
    }
  }, [panning, marquee.isSelecting, marquee.additive, marqueeHits, elements]);

  const onPointerCancel = useCallback(() => {
    if (panning) setPanning(false);
    if (marquee.isSelecting) {
      setMarquee({ isSelecting: false, start: { x: 0, y: 0 }, current: { x: 0, y: 0 }, additive: false });
      setMarqueeHits(new Set());
    }
  }, [panning, marquee.isSelecting]);

  const onLostPointerCapture = useCallback(() => {
    if (panning) setPanning(false);
    if (marquee.isSelecting) {
      setMarquee({ isSelecting: false, start: { x: 0, y: 0 }, current: { x: 0, y: 0 }, additive: false });
      setMarqueeHits(new Set());
    }
  }, [panning, marquee.isSelecting]);

  const getViewCenterCanvas = useCallback(() => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return toCanvasCoords(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [toCanvasCoords]);

  const finalizeDeletion = useCallback(async (el: CanvasElement | null) => {
    if (!el) return;
    try {
      const group = (el as any)._group as CanvasElement[] | undefined;
      if (group && Array.isArray(group)) {
        for (const child of group) {
          await finalizeDeletion(child);
        }
        return;
      }
      if (el.imageUrl && el.imageUrl.startsWith("blob:")) {
        try { URL.revokeObjectURL(el.imageUrl); } catch {}
      }
      if (el.videoUrl && el.videoUrl.startsWith("blob:")) {
        try { URL.revokeObjectURL(el.videoUrl); } catch {}
      }
      if (el.imageKey) await deleteBlob(el.imageKey);
      if (el.videoKey) await deleteBlob(el.videoKey);
    } catch {}
  }, []);

  const clearUndoTimerById = useCallback((undoId: string) => {
    const timers = undoTimersRef.current;
    const t = timers[undoId];
    if (t != null) {
      window.clearTimeout(t);
      delete timers[undoId];
    }
  }, []);

  const scheduleUndoExpiry = useCallback((undoId: string, el: CanvasElement) => {
    const timer = window.setTimeout(() => {
      void finalizeDeletion(el);
      setUndoStack((prev) => prev.filter((s: any) => (s as any)._undoId !== undoId));
      clearUndoTimerById(undoId);
    }, UNDO_TTL_MS);
    undoTimersRef.current[undoId] = timer;
  }, [clearUndoTimerById, finalizeDeletion]);

  const pushUndoSnapshot = useCallback((snapshot: CanvasElement) => {
    const undoId = `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    (snapshot as any)._undoId = undoId;
    setUndoStack((prev) => [...prev, snapshot]);
    scheduleUndoExpiry(undoId, snapshot);
  }, [scheduleUndoExpiry]);

  // Track Space key globally so state resets even if focus changes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") setIsSpace(true);
      if (e.key === "Shift" || e.key === "Meta" || e.key === "Control") setIsAdditiveKeyDown(true);
      if (e.key === "Escape" && pickRequest) {
        const rid = pickRequest.requestId;
        setPickRequest(null);
        window.dispatchEvent(new CustomEvent("lupe:pick-cancelled", { detail: { requestId: rid } }));
      }
      // Zoom shortcuts
      if ((e.metaKey || e.ctrlKey) && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        applyZoom(view.zoom * 1.1);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "-") {
        e.preventDefault();
        applyZoom(view.zoom / 1.1);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "0") {
        e.preventDefault();
        onReset();
      }
      // Delete / Backspace to remove selected element(s)
      if (e.key === "Delete" || e.key === "Backspace") {
        // If user is typing in an input/textarea/contenteditable, don't intercept
        const ae = document.activeElement as HTMLElement | null;
        const tag = (ae?.tagName || "").toLowerCase();
        const isTextInput = tag === "input" || tag === "textarea" || (ae && ae.isContentEditable);
        if (isTextInput) return;

        const idsArray = selectedIds.size > 0 ? Array.from(selectedIds) : (selectedId ? [selectedId] : []);
        if (idsArray.length > 1) {
          // Multi-delete: aggregate into a single undo of the group
          e.preventDefault();
          if (typeof e.stopPropagation === "function") e.stopPropagation();
          const ids = new Set(idsArray);
          // Build a synthetic group element to restore on undo
          const group = elements.filter((el) => ids.has(el.id));
          const snapshot: CanvasElement = {
            id: `group-${Date.now()}`,
            type: "image",
            position: group[0]?.position || { x: 0, y: 0 },
            size: group[0]?.size || { width: 1, height: 1 },
          } as any;
          // Stash the first; and attach rest via a private property for undo
          (snapshot as any)._group = group.map((e) => ({ ...e }));
          pushUndoSnapshot(snapshot);
          setElements((prev) => prev.filter((el) => !ids.has(el.id)));
          setSelectedIds(new Set());
          setSelectedId(null);
          return;
        }
        if (idsArray.length === 1) {
          // Single delete: preserve existing undo behavior
          const id = idsArray[0]!;
          e.preventDefault();
          if (typeof e.stopPropagation === "function") e.stopPropagation();
          const toDelete = elements.find((el) => el.id === id);
          if (toDelete) {
            // Prepare for undo: keep deleted element in memory and schedule finalization
            pushUndoSnapshot(toDelete);
            setElements((prev) => prev.filter((el) => el.id !== id));
            setSelectedId(null);
            setSelectedIds(new Set());
          }
          return;
        }
      }

      // Copy selected elements (Ctrl+C / Cmd+C)
      if ((e.ctrlKey || e.metaKey) && e.key === "c") {
        // If user is typing in an input/textarea/contenteditable, don't intercept
        const ae = document.activeElement as HTMLElement | null;
        const tag = (ae?.tagName || "").toLowerCase();
        const isTextInput = tag === "input" || tag === "textarea" || (ae && ae.isContentEditable);
        if (isTextInput) return;

        const idsArray = selectedIds.size > 0 ? Array.from(selectedIds) : (selectedId ? [selectedId] : []);
        if (idsArray.length > 0) {
          e.preventDefault();
          if (typeof e.stopPropagation === "function") e.stopPropagation();

          // Get selected elements and prepare for clipboard
          const selectedElements = elements.filter((el) => idsArray.includes(el.id));
          const clipboardData: CanvasElement[] = selectedElements.map((el) => ({
            ...el,
            id: "", // Will be regenerated on paste
            z: undefined, // Will be set to top on paste
            userMoved: undefined,
            lastUserMoveAt: undefined,
            animateMove: undefined,
          }));

          setClipboardElements(clipboardData);
        }
        return;
      }

      // Paste elements (Ctrl+V / Cmd+V)
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        // If user is typing in an input/textarea/contenteditable, don't intercept
        const ae = document.activeElement as HTMLElement | null;
        const tag = (ae?.tagName || "").toLowerCase();
        const isTextInput = tag === "input" || tag === "textarea" || (ae && ae.isContentEditable);
        if (isTextInput) return;

        if (clipboardElements.length > 0) {
          e.preventDefault();
          if (typeof e.stopPropagation === "function") e.stopPropagation();

          // Calculate group bounds and offset for smart positioning
          let minX = Infinity, minY = Infinity;
          for (const el of clipboardElements) {
            minX = Math.min(minX, el.position.x);
            minY = Math.min(minY, el.position.y);
          }

          const offset = clipboardElements.length === 1 ? 20 : 30;

          // Create new elements with new IDs and offset positions
          const newElements: CanvasElement[] = [];
          const newIds: string[] = [];

          for (let i = 0; i < clipboardElements.length; i++) {
            const original = clipboardElements[i];
            const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${i}`;

            // For single element, simple offset. For groups, maintain relative positions
            const newPosition = clipboardElements.length === 1
              ? {
                  x: original.position.x + offset,
                  y: original.position.y + offset,
                }
              : {
                  x: original.position.x - minX + offset,
                  y: original.position.y - minY + offset,
                };

            const newElement: CanvasElement = {
              ...original,
              id: newId,
              position: newPosition,
              z: Date.now() + i, // Bring to front
            };

            newElements.push(newElement);
            newIds.push(newId);
          }

          // Handle asset duplication for images/videos
          const handleAssetDuplication = async () => {
            const updatedElements = [...newElements];

            for (let i = 0; i < updatedElements.length; i++) {
              const element = updatedElements[i];
              if (element.type === "image" && element.imageKey) {
                try {
                  const blob = await getBlob(element.imageKey);
                  if (blob) {
                    const newKey = `image-${element.id}`;
                    await putBlob(newKey, blob);
                    updatedElements[i] = { ...element, imageKey: newKey };
                  }
                } catch (error) {
                  console.warn("Failed to duplicate image blob:", error);
                }
              } else if (element.type === "video" && element.videoKey) {
                try {
                  const blob = await getBlob(element.videoKey);
                  if (blob) {
                    const newKey = `video-${element.id}`;
                    await putBlob(newKey, blob);
                    updatedElements[i] = { ...element, videoKey: newKey };
                  }
                } catch (error) {
                  console.warn("Failed to duplicate video blob:", error);
                }
              }
            }

            // Update canvas with elements that have new keys
            setElements((prev) => {
              const withoutNew = prev.filter((el) => !newIds.includes(el.id));
              return [...withoutNew, ...updatedElements];
            });
          };

          // Add elements to canvas (initially without keys, will be updated)
          setElements((prev) => [...prev, ...newElements]);

          // Create undo snapshot for the paste operation
          if (newElements.length === 1) {
            pushUndoSnapshot(newElements[0]);
          } else {
            // For multi-element paste, create a group snapshot like multi-delete
            const groupSnapshot: CanvasElement = {
              id: `paste-group-${Date.now()}`,
              type: "image",
              position: newElements[0]?.position || { x: 0, y: 0 },
              size: newElements[0]?.size || { width: 1, height: 1 },
            } as any;
            (groupSnapshot as any)._group = newElements.map((e) => ({ ...e }));
            pushUndoSnapshot(groupSnapshot);
          }

          // Handle asset duplication in background
          handleAssetDuplication();

          // Select the pasted elements
          if (newIds.length === 1) {
            setSelectedId(newIds[0]);
            setSelectedIds(new Set());
          } else {
            setSelectedIds(new Set(newIds));
            setSelectedId(null);
          }

          // Schedule layout for new elements
          for (const el of newElements) {
            scheduleSpawnGroupLayout(el.id);
          }
        }
        return;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setIsSpace(false);
      if (e.key === "Shift" || e.key === "Meta" || e.key === "Control") setIsAdditiveKeyDown(false);
    };
    const handleBlur = () => setIsSpace(false);
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") setIsSpace(false);
    };
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [applyZoom, onReset, view.zoom, selectedId, selectedIds, elements, finalizeDeletion, undoStack, scheduleUndoExpiry, clearUndoTimerById, pickRequest]);

  // Listen for pick-image requests from the PromptForm
  useEffect(() => {
    const onPick = (e: Event) => {
      const { requestId } = (e as CustomEvent).detail || {};
      if (!requestId) return;
      setPickRequest({ requestId });
    };
    window.addEventListener("lupe:pick-image", onPick as EventListener);
    return () => window.removeEventListener("lupe:pick-image", onPick as EventListener);
  }, []);

  const urlPoolRef = useRef<string[]>([]);
  const createUrl = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urlPoolRef.current.push(url);
    return url;
  };
  // Grid placement cache per generation batch
  const spawnGridByGroupRef = useRef<Record<string, { center: { x: number; y: number }; colCount: number; itemW: number; itemH: number; colGap: number; rowGap: number; left: number; top0: number }>>({});

  const toScaledDataURL = (img: HTMLImageElement, width: number, height: number, mime: string): string | undefined => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return undefined;
      ctx.drawImage(img, 0, 0, width, height);
      const quality = mime === "image/jpeg" || mime === "image/webp" ? 0.9 : undefined;
      // TS expects second arg to be number only for certain mime types; cast for simplicity
      return canvas.toDataURL(mime, quality as any);
    } catch {
      return undefined;
    }
  };

  // Restore persisted elements on mount only when not working with a remote doc
  useEffect(() => {
    if (docIdProp) return;
    let cancelled = false;
    (async () => {
      const meta = loadElementsMetadata();
      if (!meta || meta.length === 0) return;
      const restored: CanvasElement[] = [];
      for (const m of meta) {
        const el: CanvasElement = { ...m } as CanvasElement;
        try {
          if (m.type === "image" && m.imageKey) {
            const blob = await getBlob(m.imageKey);
            if (blob) el.imageUrl = createUrl(blob);
          }
          if (m.type === "video" && m.videoKey) {
            const blob = await getBlob(m.videoKey);
            if (blob) el.videoUrl = createUrl(blob);
          }
        } catch {
          // ignore
        }
        restored.push(el);
      }
      if (!cancelled) setElements(restored);
    })();
    return () => {
      cancelled = true;
      for (const url of urlPoolRef.current) URL.revokeObjectURL(url);
      urlPoolRef.current = [];
    };
  }, [docIdProp]);

  // Load remote canvas data when doc id changes (e.g., selecting a project)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!docId) {
        setRemoteReady(false);
        return;
      }
      
      // Reset state for new document
      if (currentDocIdRef.current !== docId) {
        setRemoteReady(false);
        currentDocIdRef.current = docId;
        // Clear grid group state on doc changes
        spawnGridByGroupRef.current = {};
      }
      
      setSuppressSave(true);
      try {
        const res = await fetch(`/api/canvases/${docId}`, { cache: "no-store" });
        if (!res.ok) {
          // Doc doesn't exist yet, that's fine - start with empty canvas
          if (!cancelled) {
            setElements([]);
            setView({ zoom: 1, pan: { x: 0, y: 0 } });
            setRemoteReady(true);
          }
          return;
        }
        const data = await res.json();
        const payload = data?.data;
        if (!payload || typeof payload !== "object") {
          if (!cancelled) {
            setElements([]);
            setView({ zoom: 1, pan: { x: 0, y: 0 } });
            setRemoteReady(true);
          }
          return;
        }
        const els = Array.isArray(payload.elements) ? payload.elements : [];
        const nextView = payload.viewState && typeof payload.viewState === "object" ? payload.viewState : { zoom: 1, pan: { x: 0, y: 0 } };
        if (!cancelled) {
          setElements(els as CanvasElement[]);
          setView(nextView as ViewState);
          setRemoteReady(true);
        }
      } catch {
        if (!cancelled) {
          setElements([]);
          setView({ zoom: 1, pan: { x: 0, y: 0 } });
          setRemoteReady(true);
        }
      }
      finally {
        if (!cancelled) setSuppressSave(false);
      }
    })();
    return () => { cancelled = true; };
  }, [docId]);

  // Persist metadata locally only when not using a remote doc
  useEffect(() => {
    if (docIdProp) return;
    const t = setTimeout(() => {
      const meta = elements.map((e) => {
        // Keep remote URLs (https/http); drop only volatile blob:/data: URLs
        const copy: any = { ...e };
        if (typeof copy.imageUrl === "string") {
          const iu = copy.imageUrl as string;
          if (iu.startsWith("blob:")) {
            delete copy.imageUrl;
          } else if (iu.startsWith("data:")) {
            // Only drop data URLs if we have a durable key to restore from
            if (copy.imageKey) delete copy.imageUrl;
          }
        }
        if (typeof copy.videoUrl === "string") {
          const vu = copy.videoUrl as string;
          if (vu.startsWith("blob:")) {
            delete copy.videoUrl;
          } else if (vu.startsWith("data:")) {
            if (copy.videoKey) delete copy.videoUrl;
          }
        }
        return copy;
      });
      saveElementsMetadata(meta as any);
    }, 0);
    return () => clearTimeout(t);
  }, [elements, docIdProp]);

  // Background upload for locally-added blobs to Supabase Storage, then upgrade to public URLs
  useEffect(() => {
    if (!user?.id || !docId) return;
    let cancelled = false;
    (async () => {
      // Find candidates that need upload (blob:/data: or only IndexedDB key)
      const candidates = elements.filter((e) => {
        if (e.type !== "image" && e.type !== "video") return false;
        const url = e.type === "image" ? e.imageUrl : e.videoUrl;
        const hasRemote = typeof url === "string" && /^https?:\/\//i.test(url);
        const needsFromKey = !hasRemote && ((e.type === "image" && e.imageKey) || (e.type === "video" && e.videoKey));
        const isBlobOrData = typeof url === "string" && (/^blob:/i.test(url) || /^data:/i.test(url));
        return (needsFromKey || isBlobOrData);
      });
      for (const el of candidates) {
        if (cancelled) return;
        const already = uploadingRef.current.has(el.id);
        if (already) continue;
        uploadingRef.current.add(el.id);
        try {
          let blob: Blob | undefined;
          let mime = "";
          if (el.type === "image") {
            if (el.imageKey) {
              blob = await getBlob(el.imageKey);
            }
            if (!blob && el.imageUrl) {
              try { blob = await (await fetch(el.imageUrl)).blob(); } catch {}
            }
          } else if (el.type === "video") {
            if (el.videoKey) {
              blob = await getBlob(el.videoKey);
            }
            if (!blob && el.videoUrl) {
              try { blob = await (await fetch(el.videoUrl)).blob(); } catch {}
            }
          }
          if (!blob) continue;
          mime = blob.type || (el.type === "image" ? "image/png" : "video/mp4");
          const publicUrl = await uploadAssetAndGetPublicUrl(blob, {
            userId: user.id,
            canvasId: docId,
            elementId: el.id,
            mimeType: mime,
            kind: el.type === "image" ? "image" : "video",
          });
          if (cancelled || !publicUrl) continue;
          setElements((prev) => prev.map((p) => {
            if (p.id !== el.id) return p;
            if (el.type === "image") return { ...p, imageUrl: publicUrl };
            return { ...p, videoUrl: publicUrl };
          }));
        } catch {
        } finally {
          uploadingRef.current.delete(el.id);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [elements, user?.id, docId]);

  const addFiles = useCallback(async (files: FileList) => {
    const center = getViewCenterCanvas();
    const maxDim = 800; // px in canvas units

    const newElements: CanvasElement[] = [];
    for (const file of Array.from(files)) {
      const typeRoot = file.type.split("/")[0];
      if (typeRoot !== "image" && typeRoot !== "video") {
        continue;
      }
      const fileUrl = createUrl(file);

      // Determine intrinsic size
      let width = 400;
      let height = 300;
      let measuredImage: HTMLImageElement | null = null;
      if (typeRoot === "image") {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = fileUrl;
        });
        measuredImage = img;
        width = img.naturalWidth;
        height = img.naturalHeight;
      } else if (typeRoot === "video") {
        const dims = await new Promise<{ w: number; h: number }>((resolve) => {
          const v = document.createElement("video");
          v.preload = "metadata";
          v.src = fileUrl;
          v.onloadedmetadata = () => {
            resolve({ w: v.videoWidth || 640, h: v.videoHeight || 360 });
          };
        });
        width = dims.w;
        height = dims.h;
      }

      // Scale down to fit maxDim while preserving aspect
      const scale = Math.min(1, maxDim / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));

      // Position so that element center aligns with view center
      const pos = { x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2) };

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let imageKey: string | undefined = undefined;
      let videoKey: string | undefined = undefined;

      // Persist blob in IndexedDB only if successful; otherwise fall back
      try {
        if (typeRoot === "image") {
          const key = `image-${id}`;
          await putBlob(key, file);
          imageKey = key;
        } else if (typeRoot === "video") {
          const key = `video-${id}`;
          await putBlob(key, file);
          videoKey = key;
        }
      } catch {
        // proceed with fallback below
      }

      // Prepare fallback data URL for images when no IndexedDB key available
      let dataUrlFallback: string | undefined = undefined;
      if (typeRoot === "image" && !imageKey && measuredImage) {
        const preferredMime =
          file.type === "image/jpeg" || file.type === "image/webp" || file.type === "image/png"
            ? file.type
            : "image/png";
        dataUrlFallback = toScaledDataURL(measuredImage, width, height, preferredMime);
      }

      const element: CanvasElement = {
        id,
        type: typeRoot as "image" | "video",
        position: pos,
        size: { width, height },
        imageUrl: typeRoot === "image" ? (dataUrlFallback ?? fileUrl) : undefined,
        videoUrl: typeRoot === "video" ? fileUrl : undefined,
        imageKey,
        videoKey,
        z: Date.now(),
      };
      newElements.push(element);
    }

    if (newElements.length > 0) {
      setElements((prev) => [...prev, ...newElements]);
      // Schedule layout for each newly added element
      for (const el of newElements) {
        scheduleSpawnGroupLayout(el.id);
      }
    }
  }, [getViewCenterCanvas]);

  const undoDelete = useCallback(async () => {
    const snapshot = undoStack[undoStack.length - 1];
    if (!snapshot) return;
    const undoId = (snapshot as any)._undoId as string | undefined;
    if (undoId) clearUndoTimerById(undoId);
    setUndoStack((prev) => prev.slice(0, -1));
    const group = (snapshot as any)._group as CanvasElement[] | undefined;
    if (group && group.length > 0) {
      const restored: CanvasElement[] = [];
      for (const g of group) {
        const el = { ...g };
        try {
          if (el.type === "image" && el.imageKey) {
            const blob = await getBlob(el.imageKey);
            if (blob) el.imageUrl = createUrl(blob);
          }
          if (el.type === "video" && el.videoKey) {
            const blob = await getBlob(el.videoKey);
            if (blob) el.videoUrl = createUrl(blob);
          }
        } catch {}
        restored.push(el);
      }
      setElements((prev) => [...prev, ...restored]);
    } else {
      const el = { ...snapshot };
      try {
        if (el.type === "image" && el.imageKey) {
          const blob = await getBlob(el.imageKey);
          if (blob) el.imageUrl = createUrl(blob);
        }
        if (el.type === "video" && el.videoKey) {
          const blob = await getBlob(el.videoKey);
          if (blob) el.videoUrl = createUrl(blob);
        }
      } catch {}
      setElements((prev) => [...prev, el]);
    }
  }, [clearUndoTimerById, undoStack]);

  // Listen for programmatic image insertions (e.g., from generation)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { url: string; width?: number; height?: number; __group?: { requestGroupId: string; column: number; row: number; totalColumns: number }; prompt?: string; placeholderId?: string };
      if (!detail?.url) return;
      
      // If this is filling an existing placeholder, update it in place
      if (detail.placeholderId) {
        (async () => {
          const maxDim = 800;
          
          // Measure the actual image dimensions
          const measure = (src: string): Promise<{ width: number; height: number }> =>
            new Promise((resolve) => {
              const img = document.createElement("img");
              img.onload = () => {
                const naturalW = img.naturalWidth || detail.width || 512;
                const naturalH = img.naturalHeight || detail.height || 512;
                const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
                const width = Math.max(1, Math.round(naturalW * scale));
                const height = Math.max(1, Math.round(naturalH * scale));
                resolve({ width, height });
              };
              img.onerror = () => resolve({ width: detail.width ?? 512, height: detail.height ?? 512 });
              img.src = src;
            });
          
          const dims = await measure(detail.url);
          
          // Update the existing placeholder element
          setElements((prev) =>
            prev.map((el) =>
              el.id === detail.placeholderId
                ? {
                    ...el,
                    imageUrl: detail.url,
                    isGenerating: false,
                    size: dims, // Update to actual image dimensions
                  }
                : el
            )
          );
        })();
        return;
      }
      (async () => {
        const center = getViewCenterCanvas();

        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const maxDim = 800;

        // Compute dimensions from the remote image URL returned by FAL
        const measure = (src: string): Promise<{ width: number; height: number }> =>
          new Promise((resolve) => {
            const img = document.createElement("img");
            img.onload = () => {
              const naturalW = img.naturalWidth || detail.width || 512;
              const naturalH = img.naturalHeight || detail.height || 512;
              const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
              const width = Math.max(1, Math.round(naturalW * scale));
              const height = Math.max(1, Math.round(naturalH * scale));
              resolve({ width, height });
            };
            img.onerror = () => resolve({ width: detail.width ?? 512, height: detail.height ?? 512 });
            img.src = src;
          });

        const dims = await measure(detail.url);
        const pos = { x: Math.round(center.x - dims.width / 2), y: Math.round(center.y - dims.height / 2) };
        const element: CanvasElement = {
          id,
          type: "image",
          position: pos,
          size: { width: dims.width, height: dims.height },
          imageUrl: detail.url,
          z: Date.now(),
          animateMove: false,
          prompt: detail.prompt,
        };
        setElements((prev) => [...prev, element]);
        const g = detail.__group;
        if (g && typeof g.requestGroupId === "string" && Number.isFinite(g.column) && Number.isFinite(g.row) && Number.isFinite(g.totalColumns)) {
          // Column/row grid placement per prompt
          const groupId = g.requestGroupId;
          const colCount = Math.max(1, Math.min(12, Math.floor(g.totalColumns)));
          const colGap = 24;
          const rowGap = 24;
          // Compute grid anchor (center) and column positions on first spawn
          const gridRef = (spawnGridByGroupRef.current ||= {} as any) as Record<string, { center: { x: number; y: number }; colCount: number; itemW: number; itemH: number; colGap: number; rowGap: number; left: number; top0: number }>;
          if (!gridRef[groupId]) {
            const totalWidth = colCount * dims.width + (colCount - 1) * colGap;
            const left = center.x - totalWidth / 2;
            const top0 = center.y - dims.height / 2; // first row centered vertically
            gridRef[groupId] = {
              center,
              colCount,
              itemW: dims.width,
              itemH: dims.height,
              colGap,
              rowGap,
              left,
              top0,
            };
          }
          const cfg = gridRef[groupId]!;
          const col = Math.max(0, Math.min(cfg.colCount - 1, Math.floor(g.column)));
          const row = Math.max(0, Math.floor(g.row));
          const target = {
            x: Math.round(cfg.left + col * (cfg.itemW + cfg.colGap)),
            y: Math.round(cfg.top0 + row * (cfg.itemH + cfg.rowGap)),
          };
          // Animate from center to target
          window.setTimeout(() => {
            setElements((prev) => prev.map((p) => (p.id === id ? { ...p, position: target, animateMove: true } : p)));
            window.setTimeout(() => {
              setElements((curr) => curr.map((p) => (p.id === id ? { ...p, animateMove: false } : p)));
            }, 450);
          }, 50);
        } else {
          // Fallback to existing overlap-resolving spawn behavior
          scheduleSpawnGroupLayout(id);
        }
      })();
    };
    window.addEventListener("lupe:add-image", handler as EventListener);
    return () => window.removeEventListener("lupe:add-image", handler as EventListener);
  }, [getViewCenterCanvas]);

  // Listen for programmatic video insertions
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { url: string; prompt?: string; placeholderId?: string };
      if (!detail?.url) return;
      
      // If this is filling an existing placeholder, update it in place
      if (detail.placeholderId) {
        (async () => {
          // Measure remote video dimensions using metadata
          const measureVideo = (src: string): Promise<{ width: number; height: number }> =>
            new Promise((resolve) => {
              const v = document.createElement("video");
              v.preload = "metadata";
              v.onloadedmetadata = () => {
                const naturalW = v.videoWidth || 640;
                const naturalH = v.videoHeight || 360;
                const maxDim = 800;
                const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
                const width = Math.max(1, Math.round(naturalW * scale));
                const height = Math.max(1, Math.round(naturalH * scale));
                resolve({ width, height });
              };
              v.onerror = () => resolve({ width: 640, height: 360 });
              v.src = src;
            });
          
          const dims = await measureVideo(detail.url);
          
          // Update the existing placeholder element
          setElements((prev) =>
            prev.map((el) =>
              el.id === detail.placeholderId
                ? {
                    ...el,
                    videoUrl: detail.url,
                    isGenerating: false,
                    size: dims, // Update to actual video dimensions
                  }
                : el
            )
          );
        })();
        return;
      }
      (async () => {
        const center = getViewCenterCanvas();
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Measure remote video dimensions using metadata
        const measureVideo = (src: string): Promise<{ width: number; height: number }> =>
          new Promise((resolve) => {
            const v = document.createElement("video");
            v.preload = "metadata";
            v.onloadedmetadata = () => {
              const naturalW = v.videoWidth || 640;
              const naturalH = v.videoHeight || 360;
              const maxDim = 800;
              const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
              const width = Math.max(1, Math.round(naturalW * scale));
              const height = Math.max(1, Math.round(naturalH * scale));
              resolve({ width, height });
            };
            v.onerror = () => resolve({ width: 640, height: 360 });
            v.src = src;
          });

        const dims = await measureVideo(detail.url);
        const pos = { x: Math.round(center.x - dims.width / 2), y: Math.round(center.y - dims.height / 2) };
        const element: CanvasElement = {
          id,
          type: "video",
          position: pos,
          size: { width: dims.width, height: dims.height },
          videoUrl: detail.url,
          z: Date.now(),
          animateMove: false,
          prompt: detail.prompt,
        };
        setElements((prev) => [...prev, element]);
        scheduleSpawnGroupLayout(id);
      })();
    };
    window.addEventListener("lupe:add-video", handler as EventListener);
    return () => window.removeEventListener("lupe:add-video", handler as EventListener);
  }, [getViewCenterCanvas]);

  // Listen for placeholder creation
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; kind: "image" | "video"; width: number; height: number; __group?: { requestGroupId: string; column: number; row: number; totalColumns: number }; prompt?: string };
      if (!detail?.id) return;
      
      const center = getViewCenterCanvas();
      const pos = { x: Math.round(center.x - detail.width / 2), y: Math.round(center.y - detail.height / 2) };
      
      const element: CanvasElement = {
        id: detail.id,
        type: detail.kind,
        position: pos,
        size: { width: detail.width, height: detail.height },
        z: Date.now(),
        animateMove: false,
        prompt: detail.prompt,
        isGenerating: true,
      };
      
      setElements((prev) => [...prev, element]);
      
      // Handle grid placement for batched placeholders
      const g = detail.__group;
      if (g && typeof g.requestGroupId === "string" && Number.isFinite(g.column) && Number.isFinite(g.row) && Number.isFinite(g.totalColumns)) {
        const groupId = g.requestGroupId;
        const colCount = Math.max(1, Math.min(12, Math.floor(g.totalColumns)));
        const colGap = 24;
        const rowGap = 24;
        
        const gridRef = (spawnGridByGroupRef.current ||= {} as any) as Record<string, { center: { x: number; y: number }; colCount: number; itemW: number; itemH: number; colGap: number; rowGap: number; left: number; top0: number }>;
        if (!gridRef[groupId]) {
          const totalWidth = colCount * detail.width + (colCount - 1) * colGap;
          const left = center.x - totalWidth / 2;
          const top0 = center.y - detail.height / 2;
          gridRef[groupId] = {
            center,
            colCount,
            itemW: detail.width,
            itemH: detail.height,
            colGap,
            rowGap,
            left,
            top0,
          };
        }
        
        const cfg = gridRef[groupId]!;
        const col = Math.max(0, Math.min(cfg.colCount - 1, Math.floor(g.column)));
        const row = Math.max(0, Math.floor(g.row));
        const target = {
          x: Math.round(cfg.left + col * (cfg.itemW + cfg.colGap)),
          y: Math.round(cfg.top0 + row * (cfg.itemH + cfg.rowGap)),
        };
        
        // Animate from center to target
        window.setTimeout(() => {
          setElements((prev) => prev.map((p) => (p.id === detail.id ? { ...p, position: target, animateMove: true } : p)));
          window.setTimeout(() => {
            setElements((curr) => curr.map((p) => (p.id === detail.id ? { ...p, animateMove: false } : p)));
          }, 450);
        }, 50);
      }
    };
    
    window.addEventListener("lupe:add-placeholder", handler as EventListener);
    return () => window.removeEventListener("lupe:add-placeholder", handler as EventListener);
  }, [getViewCenterCanvas]);

  // Listen for placeholder removal
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string };
      if (!detail?.id) return;
      
      setElements((prev) => prev.filter((el) => el.id !== detail.id));
    };
    
    window.addEventListener("lupe:remove-placeholder", handler as EventListener);
    return () => window.removeEventListener("lupe:remove-placeholder", handler as EventListener);
  }, []);

  // Listen for error replacement
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; message: string };
      if (!detail?.id || !detail?.message) return;
      
      setElements((prev) => prev.map((el) => {
        if (el.id !== detail.id) return el;
        
        // Replace the placeholder/element with an error text element
        return {
          ...el,
          type: "text" as const,
          text: detail.message,
          isGenerating: false,
          error: true,
          // Remove any image/video URLs since this is now a text element
          imageUrl: undefined,
          videoUrl: undefined,
          imageKey: undefined,
          videoKey: undefined,
        };
      }));
    };
    
    window.addEventListener("lupe:replace-with-error", handler as EventListener);
    return () => window.removeEventListener("lupe:replace-with-error", handler as EventListener);
  }, []);

  // Handle pending adds from history page
  useEffect(() => {
    if (!docId || !remoteReady) return;
    
    const processPendingAdd = () => {
      const pendingData = sessionStorage.getItem("lupe:pending-add");
      if (!pendingData) return;
      
      try {
        const payload = JSON.parse(pendingData);
        if (payload.projectId !== docId) return;
        
        // Check for duplicate processing with doc-scoped dedup
        const dedupKey = `lupe:last-processed:${docId}`;
        const lastProcessed = sessionStorage.getItem(dedupKey);
        if (lastProcessed === payload.batchId) return;
        
        // Clear the pending data and mark as processed
        sessionStorage.removeItem("lupe:pending-add");
        if (payload.batchId) {
          sessionStorage.setItem(dedupKey, payload.batchId);
        }
        
        const { items, layout } = payload;
        if (!Array.isArray(items) || items.length === 0) return;
        
        const requestGroupId = payload.batchId || `history-add-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const columns = layout?.columns || Math.min(3, Math.ceil(Math.sqrt(items.length)));
        
        // Dispatch events for each item
        items.forEach((item: any, index: number) => {
          const column = index % columns;
          const row = Math.floor(index / columns);
          
          if (item.kind === "image") {
            window.dispatchEvent(
              new CustomEvent("lupe:add-image", {
                detail: {
                  url: item.url,
                  width: item.width,
                  height: item.height,
                  prompt: item.prompt,
                  __group: { requestGroupId, column, row, totalColumns: columns }
                }
              })
            );
          } else if (item.kind === "video") {
            window.dispatchEvent(
              new CustomEvent("lupe:add-video", {
                detail: {
                  url: item.url,
                  prompt: item.prompt
                }
              })
            );
          }
        });
        
        // Show success feedback
        console.log(`Added ${items.length} assets to canvas`);
        
        // Dispatch success event for potential toast notifications
        window.dispatchEvent(
          new CustomEvent("lupe:assets-added", {
            detail: { count: items.length }
          })
        );
      } catch (error) {
        console.error("Failed to process pending add:", error);
        sessionStorage.removeItem("lupe:pending-add");
      }
    };

    // Process only when both docId and remoteReady are true
    processPendingAdd();
  }, [docId, remoteReady]);

  // ---- Auto-layout for overlapping spawn groups ----
  const USER_MOVE_COOLDOWN_MS = 5000;

  // Compute minimal non-overlapping positions near the group center
  const computeResolvedPositions = useCallback(
    (
      groupElements: Array<{ id: string; position: { x: number; y: number }; size: { width: number; height: number } }>,
      groupCenter: { x: number; y: number },
      options?: { iterations?: number; margin?: number; attraction?: number; overlapRatio?: number }
    ): Record<string, { x: number; y: number }> => {
      const iterations = options?.iterations ?? 24;
      const margin = options?.margin ?? 12;
      const attraction = options?.attraction ?? 0.02;
      const overlapRatio = options?.overlapRatio ?? 0.1; // allow ~10% overlap

      const pos: Record<string, { x: number; y: number }> = {};
      const sizes: Record<string, { w: number; h: number }> = {};
      for (const el of groupElements) {
        pos[el.id] = { x: el.position.x, y: el.position.y };
        sizes[el.id] = { w: el.size.width, h: el.size.height };
      }
      const ids = groupElements.map((e) => e.id);

      for (let iter = 0; iter < iterations; iter++) {
        for (let i = 0; i < ids.length; i++) {
          const idA = ids[i];
          const a = pos[idA];
          const sa = sizes[idA];
          const axc = a.x + sa.w / 2;
          const ayc = a.y + sa.h / 2;

          // Mild attraction to group center keeps items close
          a.x += (groupCenter.x - axc) * attraction;
          a.y += (groupCenter.y - ayc) * attraction;

          for (let j = i + 1; j < ids.length; j++) {
            const idB = ids[j];
            const b = pos[idB];
            const sb = sizes[idB];

            const bxc = b.x + sb.w / 2;
            const byc = b.y + sb.h / 2;
            const dx = axc - bxc;
            const dy = ayc - byc;

            // Permit a small intentional overlap on each axis
            const allowedX = overlapRatio * Math.min(sa.w, sb.w);
            const allowedY = overlapRatio * Math.min(sa.h, sb.h);
            const thresholdX = sa.w / 2 + sb.w / 2 + margin - allowedX;
            const thresholdY = sa.h / 2 + sb.h / 2 + margin - allowedY;
            const overlapX = thresholdX - Math.abs(dx);
            const overlapY = thresholdY - Math.abs(dy);

            if (overlapX > 0 && overlapY > 0) {
              if (overlapX < overlapY) {
                const push = overlapX / 2;
                const dir = dx === 0 ? (Math.random() < 0.5 ? -1 : 1) : dx > 0 ? 1 : -1;
                a.x += push * dir;
                b.x -= push * dir;
              } else {
                const push = overlapY / 2;
                const dir = dy === 0 ? (Math.random() < 0.5 ? -1 : 1) : dy > 0 ? 1 : -1;
                a.y += push * dir;
                b.y -= push * dir;
              }
            }
          }
        }
      }

      const result: Record<string, { x: number; y: number }> = {};
      for (const id of ids) result[id] = { x: pos[id].x, y: pos[id].y };
      return result;
    },
    []
  );

  // Emit canvas-ready event on mount
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("lupe:canvas-ready"));
  }, []);

  const scheduleSpawnGroupLayout = useCallback(
    (newId: string) => {
      window.setTimeout(() => {
        setElements((prev) => {
          const byId: Record<string, CanvasElement> = Object.create(null);
          for (const el of prev) byId[el.id] = el;

          const seedEl = byId[newId];
          if (!seedEl) return prev;
          if ((seedEl.type !== "image" && seedEl.type !== "video") || seedEl.isGenerating) return prev;

          // Skip auto-layout if user just moved the seed element
          if (seedEl.userMoved && seedEl.lastUserMoveAt && Date.now() - seedEl.lastUserMoveAt < USER_MOVE_COOLDOWN_MS) {
            return prev;
          }

          // Helpers
          const rectOf = (el: CanvasElement) => ({
            l: el.position.x,
            t: el.position.y,
            r: el.position.x + el.size.width,
            b: el.position.y + el.size.height,
          });
          const overlaps = (a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>, margin = 8) =>
            a.l < b.r + margin && a.r > b.l - margin && a.t < b.b + margin && a.b > b.t - margin;
          const centerOf = (el: CanvasElement) => ({
            x: el.position.x + el.size.width / 2,
            y: el.position.y + el.size.height / 2,
          });
          const distance = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

          const clusterIds = new Set<string>();
          const queue: string[] = [];
          clusterIds.add(newId);
          queue.push(newId);

          const seedCenter = centerOf(seedEl);
          const proximityRadius = Math.max(seedEl.size.width, seedEl.size.height) * 0.9;
          for (const el of prev) {
            if ((el.type !== "image" && el.type !== "video") || el.isGenerating) continue;
            if (clusterIds.has(el.id)) continue;
            const c = centerOf(el);
            if (distance(c.x, c.y, seedCenter.x, seedCenter.y) <= proximityRadius) {
              clusterIds.add(el.id);
              queue.push(el.id);
            }
          }

          // Flood-fill by overlap
          while (queue.length) {
            const curId = queue.pop()!;
            const curEl = byId[curId];
            if (!curEl) continue;
            const curRect = rectOf(curEl);
            for (const el of prev) {
              if ((el.type !== "image" && el.type !== "video") || el.isGenerating) continue;
              if (clusterIds.has(el.id)) continue;
              if (overlaps(curRect, rectOf(el), 14)) {
                clusterIds.add(el.id);
                queue.push(el.id);
              }
            }
          }

          if (clusterIds.size <= 1) return prev;

          // Center of cluster
          const subset = [...clusterIds].map((id) => byId[id]).filter(Boolean) as CanvasElement[];
          const centers = subset.map((el) => ({ x: el.position.x + el.size.width / 2, y: el.position.y + el.size.height / 2 }));
          const center = centers.reduce((acc, c) => ({ x: acc.x + c.x, y: acc.y + c.y }), { x: 0, y: 0 });
          center.x /= centers.length;
          center.y /= centers.length;

          const now = Date.now();
          const list = subset
            .filter((el) => !(el.userMoved && el.lastUserMoveAt && now - el.lastUserMoveAt < USER_MOVE_COOLDOWN_MS))
            .map((el) => ({ id: el.id, position: el.position, size: el.size }));
          if (list.length === 0) return prev;

          const newPositions = computeResolvedPositions(list, center, { iterations: 32, margin: 10, attraction: 0.022, overlapRatio: 0.1 });

          const withAnim = prev.map((el) => {
            const skip = el.userMoved && el.lastUserMoveAt && now - el.lastUserMoveAt < USER_MOVE_COOLDOWN_MS;
            if (skip) return el;
            return clusterIds.has(el.id) && newPositions[el.id]
              ? { ...el, position: newPositions[el.id], animateMove: true }
              : el;
          });

          // Clear animate flag after transition
          window.setTimeout(() => {
            setElements((curr) => curr.map((e) => (clusterIds.has(e.id) ? { ...e, animateMove: false } : e)));
          }, 450);

          return withAnim;
        });
      }, 80);
    },
    [computeResolvedPositions]
  );

  return (
    <div
      ref={containerRef}
      className={`relative h-screen w-screen overflow-hidden select-none ${panning ? "cursor-grabbing" : isSpace ? "cursor-grab" : ""}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onDragOverCapture={(e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      }}
      onDropCapture={(e) => {
        e.preventDefault();
        const dt = e.dataTransfer;
        if (!dt) return;
        if (dt.files && dt.files.length > 0) {
          void addFiles(dt.files);
          return;
        }
        // Handle dropping plain text/URLs to create a text box at drop point
        let dropped = (dt.getData("text/plain") || "").trim();
        if (!dropped && dt.types && Array.from(dt.types).includes("text/uri-list")) {
          dropped = (dt.getData("text/uri-list") || "").trim();
        }
        if (!dropped && dt.types && Array.from(dt.types).includes("text/html")) {
          const html = dt.getData("text/html");
          if (html) {
            const tmp = document.createElement("div");
            tmp.innerHTML = html;
            dropped = (tmp.textContent || "").trim();
          }
        }
        if (dropped) {
          const canvasPt = toCanvasCoords(e.clientX, e.clientY);
          const width = 400;
          const height = 160;
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const pos = { x: Math.round(canvasPt.x - width / 2), y: Math.round(canvasPt.y - height / 2) };
          const element: CanvasElement = {
            id,
            type: "text",
            position: pos,
            size: { width, height },
            text: dropped,
            fontSize: 32,
            z: Date.now(),
          } as any;
          setElements((prev) => [...prev, element]);
          setSelectedId(id);
          setSelectedIds(new Set([id]));
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent("lupe:focus-text", { detail: { id } }));
          }, 0);
        }
      }}
      tabIndex={0}
      style={{ touchAction: "none", overscrollBehavior: "none" }}
    >
      <GridBackground zoom={view.zoom} pan={view.pan} />
      <div ref={stageRef} className="absolute inset-0" style={stageStyle}>
        {elements
          .slice()
          .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
          .map((el) => (
            <Element
              key={el.id}
              element={el}
              zoom={view.zoom}
              selected={el.id === selectedId || selectedIds.has(el.id) || (marquee.isSelecting && marqueeHits.has(el.id))}
              onVideoToggle={handleVideoToggle}
              onSelect={(id) => {
                // Toggle or set selection depending on additive key
                setSelectedId(id);
                // If a pick request is active, immediately resolve it with this element
                if (pickRequest) {
                  const el = elements.find((e) => e.id === id);
                  if (el && el.type === "image" && el.imageUrl) {
                    const rid = pickRequest.requestId;
                    setPickRequest(null);
                    window.dispatchEvent(
                      new CustomEvent("lupe:image-picked", {
                        detail: { requestId: rid, id: el.id, url: el.imageUrl, width: el.size.width, height: el.size.height },
                      })
                    );
                    return; // Skip normal selection toggling when pick completes
                  }
                }
                // If an image is selected (and not in pick mode), blur the prompt input so Delete targets canvas
                {
                  const el = elements.find((e) => e.id === id);
                  if (el && el.type === "image") {
                    try { window.dispatchEvent(new Event("lupe:blur-prompt")); } catch {}
                  }
                }
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (isAdditiveKeyDown) {
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                  } else {
                    // Without additive key, always collapse to a single selection
                    next.clear();
                    next.add(id);
                  }
                  return next;
                });
              }}
              onMove={(id, next) => {
                const group = groupDragRef.current;
                const keys = Object.keys(group.startPositionsById || {});
                if (group.anchorId === id && keys.length > 1) {
                  const startAnchor = group.startPositionsById[id] ?? { x: next.x, y: next.y };
                  const dx = next.x - startAnchor.x;
                  const dy = next.y - startAnchor.y;
                  setElements((prev) =>
                    prev.map((p) => {
                      const sp = group.startPositionsById[p.id];
                      if (sp) {
                        return { ...p, position: { x: Math.round(sp.x + dx), y: Math.round(sp.y + dy) } };
                      }
                      return p;
                    })
                  );
                } else {
                  setElements((prev) => prev.map((p) => (p.id === id ? { ...p, position: next } : p)));
                }
              }}
              onImageTapped={(id, info) => {
                if (!pickRequest) return;
                const rid = pickRequest.requestId;
                setPickRequest(null);
                window.dispatchEvent(
                  new CustomEvent("lupe:image-picked", {
                    detail: { requestId: rid, id, url: info.url, width: info.width, height: info.height },
                  })
                );
              }}
              onDragStart={(id) => {
                // Determine current selection set
                let sel: Set<string> = selectedIds.size > 0 ? new Set(Array.from(selectedIds)) : (selectedId ? new Set([selectedId]) : new Set());
                if (!sel.has(id)) sel = new Set([id]);
                // Snapshot start positions for group move
                const starts: Record<string, { x: number; y: number }> = {};
                for (const el of elements) {
                  if (sel.has(el.id)) starts[el.id] = { x: el.position.x, y: el.position.y };
                }
                groupDragRef.current = { anchorId: id, startPositionsById: starts };
                // Bring group to front by bumping z while preserving relative order
                const topZ = Math.max(0, ...elements.map((e) => e.z ?? 0)) + 1;
                const selIds = Array.from(sel);
                setElements((prev) => {
                  let inc = 0;
                  const setSel = new Set(selIds);
                  return prev.map((p) => {
                    if (setSel.has(p.id)) {
                      const z = topZ + inc;
                      inc++;
                      return { ...p, z };
                    }
                    return p;
                  });
                });
              }}
              onDragEnd={(id) => {
                const when = Date.now();
                const group = groupDragRef.current;
                const keys = Object.keys(group.startPositionsById || {});
                if (group.anchorId === id && keys.length > 0) {
                  const setKeys = new Set(keys);
                  setElements((prev) => prev.map((p) => (setKeys.has(p.id) ? { ...p, userMoved: true, lastUserMoveAt: when } : p)));
                } else {
                  setElements((prev) => prev.map((p) => (p.id === id ? { ...p, userMoved: true, lastUserMoveAt: when } : p)));
                }
                groupDragRef.current = { anchorId: null, startPositionsById: {} };
              }}
              onResize={(id, next) => {
                setElements((prev) => prev.map((p) => {
                  if (p.id !== id) return p;
                  const updated: CanvasElement = { ...p, position: next.position, size: next.size } as any;
                  if (p.type === "text" && typeof next.fontSize === "number") {
                    (updated as any).fontSize = next.fontSize;
                  }
                  return updated;
                }));
              }}
              onEditText={(id, t) => {
                setElements((prev) => prev.map((p) => (p.id === id ? { ...p, text: t } : p)));
              }}
            />
          ))}
      </div>

      {marquee.isSelecting && !isTouchLikeDevice ? (() => {
        const sx1 = view.pan.x + marquee.start.x * view.zoom;
        const sy1 = view.pan.y + marquee.start.y * view.zoom;
        const sx2 = view.pan.x + marquee.current.x * view.zoom;
        const sy2 = view.pan.y + marquee.current.y * view.zoom;
        const left = Math.min(sx1, sx2);
        const top = Math.min(sy1, sy2);
        const width = Math.abs(sx2 - sx1);
        const height = Math.abs(sy2 - sy1);
        return (
          <div
            className="absolute z-10 pointer-events-none"
            style={{ left, top, width, height }}
          >
            <div className="w-full h-full border-2 border-sky-400/70 rounded-sm" style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.5)", background: "rgba(56,189,248,0.12)" }} />
          </div>
        );
      })() : null}

      {pickRequest ? (
        <div
          data-ui-overlay="true"
          className="fixed top-4 right-4 z-50 rounded-md bg-neutral-900 px-3 py-1 text-xs text-neutral-100 ring-1 ring-white/10"
        >
          Click an image to select it… (Esc to cancel)
        </div>
      ) : null}

      <Controls onUpload={addFiles} canUndo={undoStack.length > 0} onUndo={undoDelete} onAddText={() => {
        const center = getViewCenterCanvas();
        const width = 400;
        const height = 160;
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const pos = { x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2) };
        const element: CanvasElement = {
          id,
          type: "text",
          position: pos,
          size: { width, height },
          text: "Text",
          fontSize: 32,
          z: Date.now(),
        } as any;
        setElements((prev) => [...prev, element]);
        setSelectedId(id);
        setSelectedIds(new Set([id]));
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent("lupe:focus-text", { detail: { id } }));
        }, 0);
      }} onArrange={(mode) => arrangeSelectedImages(mode)} canArrange={(() => {
        const ids = selectedIds.size > 0 ? Array.from(selectedIds) : (selectedId ? [selectedId] : []);
        if (ids.length < 2) return false;
        let count = 0;
        for (const el of elements) {
          if (ids.includes(el.id) && (el.type === "image" || el.type === "video")) count++;
          if (count >= 2) return true;
        }
        return false;
      })()} />
    </div>
  );
}
