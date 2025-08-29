export type Point = { x: number; y: number };

export type ViewState = {
  zoom: number; // scale
  pan: Point; // in screen pixels
};

export type CanvasElement = {
  id: string;
  type: "image" | "video" | "text";
  position: Point; // canvas coords
  size: { width: number; height: number };
  text?: string;
  fontSize?: number;
  imageUrl?: string;
  videoUrl?: string;
  // Keys referencing persisted blobs in IndexedDB. Used to restore on reload.
  imageKey?: string;
  videoKey?: string;
  isGenerating?: boolean;
  z?: number;
  // User interaction and animation hints
  userMoved?: boolean;
  lastUserMoveAt?: number;
  animateMove?: boolean;
  // Prompt used to generate this asset
  prompt?: string;
  // Error state for failed generations
  error?: boolean;
};

// Persisted elements now include remote URLs (http/https). We still avoid persisting blob:/data: URLs at save-time.
export type PersistedCanvasElement = CanvasElement;
