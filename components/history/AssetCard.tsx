"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Play, Pause, Check } from "lucide-react";

type Asset = {
  id: string;
  kind: "image" | "video";
  output_url: string;
  width?: number;
  height?: number;
  duration_seconds?: number;
  model_id: string;
  canvas_id?: string;
  prompt: string;
  created_at: string;
};

type Props = {
  asset: Asset;
  selected?: boolean;
  onToggleSelect?: () => void;
};

export default function AssetCard({ asset, selected = false, onToggleSelect }: Props) {
  const router = useRouter();
  const [isPlaying, setIsPlaying] = useState(false);

  const formatDate = (isoString: string) => {
    try {
      return new Date(isoString).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "Unknown";
    }
  };

  const truncatePrompt = (text: string, maxLength = 80) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + "...";
  };

  const openOnCanvas = () => {
    if (!asset.canvas_id) return;
    localStorage.setItem("lupe:selected-project-id", asset.canvas_id);
    router.push("/");
  };

  const handleVideoToggle = (video: HTMLVideoElement) => {
    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play();
      setIsPlaying(true);
    }
  };

  return (
    <div className={`bg-neutral-900 rounded-lg overflow-hidden ring-1 transition-all ${selected ? 'ring-sky-400 ring-2' : 'ring-white/10 hover:ring-white/20'}`}>
      {/* Media */}
      <div className="relative aspect-square bg-neutral-800">
        {/* Selection Overlay */}
        {onToggleSelect && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect();
            }}
            className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full border-2 border-white bg-black/50 hover:bg-black/70 flex items-center justify-center transition-colors"
            aria-label={selected ? "Deselect asset" : "Select asset"}
          >
            {selected && <Check className="h-4 w-4 text-white" />}
          </button>
        )}
        {asset.kind === "image" ? (
          <img
            src={asset.output_url}
            alt="Generated asset"
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="relative w-full h-full">
            <video
              src={asset.output_url}
              preload="metadata"
              className="w-full h-full object-cover"
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
              onClick={(e) => handleVideoToggle(e.currentTarget)}
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                const video = e.currentTarget.parentElement?.querySelector("video");
                if (video) handleVideoToggle(video);
              }}
              className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors"
            >
              {isPlaying ? (
                <Pause className="h-8 w-8 text-white drop-shadow-lg" />
              ) : (
                <Play className="h-8 w-8 text-white drop-shadow-lg" />
              )}
            </button>
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-neutral-400 font-mono">{asset.model_id}</p>
            <p className="text-xs text-neutral-500">{formatDate(asset.created_at)}</p>
          </div>
          {asset.canvas_id && (
            <button
              onClick={openOnCanvas}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-white/10 hover:bg-white/20 rounded text-white transition-colors"
              title="Open canvas"
            >
              <ExternalLink className="h-3 w-3" />
              Open canvas
            </button>
          )}
        </div>

        <p className="text-sm text-neutral-300 leading-relaxed">
          {truncatePrompt(asset.prompt)}
        </p>

        {/* Dimensions */}
        {(asset.width || asset.height) && (
          <p className="text-xs text-neutral-500">
            {asset.width}×{asset.height}
            {asset.duration_seconds && ` • ${asset.duration_seconds}s`}
          </p>
        )}
      </div>
    </div>
  );
}
