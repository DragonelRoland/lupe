"use client";

import { createClient } from "@/lib/supabase/client";

type UploadParams = {
  userId: string;
  canvasId: string;
  elementId: string;
  mimeType: string;
  kind: "image" | "video";
};

function extensionFromMime(mime: string, fallback: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  return map[mime] || fallback;
}

export async function uploadAssetAndGetPublicUrl(blob: Blob, params: UploadParams): Promise<string | null> {
  try {
    const supabase = createClient();
    const bucket = "assets"; // Must exist and be public
    const ext = extensionFromMime(params.mimeType, params.kind === "image" ? "png" : "mp4");
    const path = `${params.userId}/${params.canvasId}/${params.kind}-${params.elementId}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, blob, { contentType: params.mimeType || (params.kind === "image" ? "image/png" : "video/mp4"), upsert: true });
    if (upErr) return null;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}


