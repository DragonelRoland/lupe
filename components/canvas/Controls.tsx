"use client";

import { RotateCcw, Upload, Type as TypeIcon, LayoutGrid } from "lucide-react";
import { useId, useRef, useState } from "react";

type Props = {
  onUpload: (files: FileList) => void;
  onUndo?: () => void;
  canUndo?: boolean;
  onAddText?: () => void;
  // Arrange selected images into a non-overlapping grid
  onArrange?: (mode?: "auto" | "row" | "column") => void;
  canArrange?: boolean;
};

export default function Controls({ onUpload, onUndo, canUndo, onAddText, onArrange, canArrange }: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = useState<string>("");

  const openPicker = () => {
    setMessage("");
    inputRef.current?.click();
  };

  return (
    <>
      <div data-ui-overlay="true" className="fixed top-4 left-16 z-50 flex items-center gap-2">
        <button
          className="grid place-items-center size-8 rounded-md bg-neutral-900 text-white ring-1 ring-white/10 hover:bg-neutral-800 active:scale-95"
          onClick={() => { if (onAddText) onAddText(); }}
          aria-label="Add text"
          title="Add text"
        >
          <TypeIcon className="h-4 w-4" />
        </button>

        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.currentTarget.files;
            if (!files || files.length === 0) return;
            try {
              onUpload(files);
              setMessage(`${files.length} file${files.length > 1 ? "s" : ""} added`);
            } catch (err) {
              setMessage("Failed to add files");
            } finally {
              e.currentTarget.value = "";
            }
          }}
        />

        <button
          className="grid place-items-center size-8 rounded-md bg-neutral-900 text-white ring-1 ring-white/10 hover:bg-neutral-800 active:scale-95"
          onClick={openPicker}
          aria-label="Upload"
        >
          <Upload className="h-4 w-4" />
        </button>

        <button
          className="grid place-items-center size-8 rounded-md bg-neutral-900 text-white ring-1 ring-white/10 hover:bg-neutral-800 active:scale-95 disabled:cursor-not-allowed disabled:text-white/40 disabled:ring-white/5 disabled:hover:bg-neutral-900 disabled:active:scale-100"
          onClick={() => { if (canUndo && onUndo) onUndo(); }}
          aria-label="Undo delete"
          disabled={!canUndo}
        >
          <RotateCcw className="h-4 w-4" />
        </button>

        <button
          className="grid place-items-center size-8 rounded-md bg-neutral-900 text-white ring-1 ring-white/10 hover:bg-neutral-800 active:scale-95 disabled:cursor-not-allowed disabled:text-white/40 disabled:ring-white/5 disabled:hover:bg-neutral-900 disabled:active:scale-100"
          onClick={() => { if (canArrange && onArrange) onArrange("auto"); }}
          aria-label="Arrange grid"
          title="Arrange selected media"
          disabled={!canArrange}
        >
          <LayoutGrid className="h-4 w-4" />
        </button>

        {message && (
          <span className="ml-2 text-xs text-white/70">{message}</span>
        )}
      </div>

    </>
  );
}
