"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CanvasElement, ViewState } from "@/components/canvas/types";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";

export type CanvasDocument = {
  id: string;
  owner_id: string;
  data: any;
  is_public?: boolean;
  public_slug?: string | null;
};

type UseCanvasDocumentOptions = {
  userId?: string | null;
  elements: CanvasElement[];
  viewState: ViewState;
  debounceMs?: number;
  docIdOverride?: string | null;
  suppressSave?: boolean;
};

const LOCAL_DOC_ID_KEY = "supabase-canvas-doc-id";

function sanitizeElementsForRemote(elements: CanvasElement[]): any[] {
  return elements.map((e) => {
    const copy: any = { ...e };
    if (typeof copy.imageUrl === "string") {
      const iu = copy.imageUrl as string;
      if (iu.startsWith("blob:")) delete copy.imageUrl;
      else if (iu.startsWith("data:")) {
        if (copy.imageKey) delete copy.imageUrl;
      }
    }
    if (typeof copy.videoUrl === "string") {
      const vu = copy.videoUrl as string;
      if (vu.startsWith("blob:")) delete copy.videoUrl;
      else if (vu.startsWith("data:")) {
        if (copy.videoKey) delete copy.videoUrl;
      }
    }
    return copy;
  });
}

export function useCanvasDocument({ userId, elements, viewState, debounceMs = 1200, docIdOverride = null, suppressSave = false }: UseCanvasDocumentOptions) {
  const supabase = useMemo(() => createSupabaseClient(), []);
  const [docId, setDocId] = useState<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const lastPayloadRef = useRef<string>("");

  // Bootstrap or load existing document id
  useEffect(() => {
    if (!userId) return;
    // If a specific doc id is provided (project selection), use it
    if (docIdOverride) {
      setDocId(docIdOverride);
      return;
    }
    const existing = localStorage.getItem(LOCAL_DOC_ID_KEY);
    if (existing) {
      setDocId(existing);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Create an empty document immediately so we have an id
        const payload = { elements: [], viewState, version: 1 };
        const { data, error } = await supabase
          .from("canvases")
          .insert([{ owner_id: userId, data: payload }])
          .select("id")
          .single();
        if (!error && data?.id && !cancelled) {
          localStorage.setItem(LOCAL_DOC_ID_KEY, data.id);
          setDocId(data.id);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, docIdOverride]);

  // Background save on changes
  useEffect(() => {
    if (!userId || !docId) return;
    if (suppressSave) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    saveTimerRef.current = window.setTimeout(() => {
      const sanitized = sanitizeElementsForRemote(elements);
      const payload = { elements: sanitized, viewState, version: 1 };
      const serialized = JSON.stringify(payload);
      if (serialized === lastPayloadRef.current) return;
      lastPayloadRef.current = serialized;
      void (async () => {
        try {
          await supabase.from("canvases").update({ data: payload }).eq("id", docId);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("Background save failed:", err);
        }
      })();
    }, debounceMs) as unknown as number;
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    };
  }, [userId, docId, elements, viewState, debounceMs, supabase, suppressSave]);

  return { docId } as const;
}


