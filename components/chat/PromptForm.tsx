"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PickedImage = { id: string; url: string; width: number; height: number };

// Model configuration for size/resolution controls
type SizeControlType = "imageSize" | "aspectRatio" | "resolution" | "none";
type SizeOption = { value: string; label: string; disabled?: boolean };

const SIZE_CONFIGS: Record<string, {
  type: SizeControlType;
  label: string;
  options: SizeOption[];
  default: string;
}> = {
  "flux-schnell": {
    type: "imageSize",
    label: "Image size",
    options: [
      { value: "landscape_4_3", label: "Landscape 4:3" },
      { value: "landscape_16_9", label: "Landscape 16:9" },
      { value: "portrait_4_3", label: "Portrait 4:3" },
      { value: "portrait_16_9", label: "Portrait 16:9" },
      { value: "square", label: "Square" },
      { value: "square_hd", label: "Square HD" },
    ],
    default: "landscape_4_3",
  },
  "flux-pro-ultra": {
    type: "aspectRatio",
    label: "Aspect ratio",
    options: [
      { value: "4:3", label: "4:3" },
      { value: "16:9", label: "16:9" },
      { value: "1:1", label: "1:1" },
      { value: "3:2", label: "3:2" },
      { value: "2:3", label: "2:3" },
      { value: "3:4", label: "3:4" },
      { value: "9:16", label: "9:16" },
      { value: "21:9", label: "21:9" },
      { value: "9:21", label: "9:21" },
    ],
    default: "4:3",
  },
  "flux-kontext-max": {
    type: "aspectRatio",
    label: "Aspect ratio",
    options: [
      { value: "auto", label: "Auto (match Image A)" },
      { value: "4:3", label: "4:3" },
      { value: "16:9", label: "16:9" },
      { value: "1:1", label: "1:1" },
      { value: "3:2", label: "3:2" },
      { value: "2:3", label: "2:3" },
      { value: "3:4", label: "3:4" },
      { value: "9:16", label: "9:16" },
      { value: "21:9", label: "21:9" },
      { value: "9:21", label: "9:21" },
    ],
    default: "auto",
  },
  "flux-multi": {
    type: "aspectRatio",
    label: "Aspect ratio",
    options: [
      { value: "auto", label: "Auto (match Image A)" },
      { value: "4:3", label: "4:3" },
      { value: "16:9", label: "16:9" },
      { value: "1:1", label: "1:1" },
      { value: "3:2", label: "3:2" },
      { value: "2:3", label: "2:3" },
      { value: "3:4", label: "3:4" },
      { value: "9:16", label: "9:16" },
      { value: "21:9", label: "21:9" },
      { value: "9:21", label: "9:21" },
    ],
    default: "auto",
  },
  "kling2.1-multi-i2v": {
    type: "aspectRatio",
    label: "Aspect ratio",
    options: [
      { value: "auto", label: "Auto (match Image A)" },
      { value: "16:9", label: "16:9" },
      { value: "9:16", label: "9:16" },
      { value: "1:1", label: "1:1" },
    ],
    default: "auto",
  },
  "seedance": {
    type: "resolution",
    label: "Resolution",
    options: [
      { value: "480p", label: "480p" },
      { value: "720p", label: "720p" },
      { value: "1080p", label: "1080p" },
    ],
    default: "480p",
  },
  "veo": {
    type: "resolution",
    label: "Resolution",
    options: [
      { value: "720p", label: "720p" },
      { value: "1080p", label: "1080p" },
    ],
    default: "720p",
  },
};

// Simple model capability map for controlling UI visibility
const MODEL_UI: Record<string, { imageInputs: number }> = {
  "flux-schnell": { imageInputs: 0 },
  "flux-kontext-max": { imageInputs: 1 },
  "flux-multi": { imageInputs: 4 },
  "flux-pro-ultra": { imageInputs: 0 },
  // Hailuo supports both text-to-video (no image) and image-to-video (one image)
  // We render one optional image picker. Submit should not be blocked when empty.
  "hailou": { imageInputs: 1 },
  // Seedance supports both text-to-video (no image) and image-to-video (one image)
  // We render one optional image picker. Submit should not be blocked when empty.
  "seedance": { imageInputs: 1 },
  // Veo supports both text-to-video (no image) and image-to-video (one image)
  // We render one optional image picker. Submit should not be blocked when empty.
  "veo": { imageInputs: 1 },
  // Kling I2V requires one image
  "kling2.1-standard-i2v": { imageInputs: 1 },
  // Kling Master I2V requires one image
  "kling2.1-master-i2v": { imageInputs: 1 },
  // Kling Pro I2V requires two images (start + tail)
  "kling2.1-pro-i2v": { imageInputs: 2 },
  // Kling Multi I2V supports 2-4 images
  "kling2.1-multi-i2v": { imageInputs: 4 },
};

export type PromptPayload = {
  prompt: string;
  model: string;
  numImages?: number;
  batchId?: string;
  batchIndex?: number;
  batchTotal?: number;
  imageA?: PickedImage | null;
  imageB?: PickedImage | null;
  imageC?: PickedImage | null;
  imageD?: PickedImage | null;
  negativePrompt?: string;
  imageSize?: "square_hd" | "square" | "portrait_4_3" | "portrait_16_9" | "landscape_4_3" | "landscape_16_9";
  aspectRatio?: "21:9" | "16:9" | "4:3" | "3:2" | "1:1" | "2:3" | "3:4" | "9:16" | "9:21";
  resolution?: "480p" | "720p" | "1080p";
};

type PromptFormProps = {
  onSubmit: (payload: PromptPayload) => void;
  disabled?: boolean;
  pendingCount?: number;
  onRequestOverLimitApproval?: (info: { toStart: number; projectedTotal: number }) => Promise<boolean>;
  spendConfirmThresholdCents?: number;
  onRequestHighSpendApproval?: (info: { totalCostCents: number; batchCount: number; imagesPerPrompt: number; modelId: string }) => Promise<boolean>;
};

export default function PromptForm({ onSubmit, disabled = false, pendingCount = 0, onRequestOverLimitApproval, spendConfirmThresholdCents, onRequestHighSpendApproval }: PromptFormProps) {
  const [inputValue, setInputValue] = useState("");
  const [negativeInputValue, setNegativeInputValue] = useState("");
  const [model, setModel] = useState<string>("flux-schnell");
  const [imageA, setImageA] = useState<PickedImage | null>(null);
  const [imageB, setImageB] = useState<PickedImage | null>(null);
  const [imageC, setImageC] = useState<PickedImage | null>(null);
  const [imageD, setImageD] = useState<PickedImage | null>(null);
  const [pendingSlot, setPendingSlot] = useState<"A" | "B" | "C" | "D" | null>(null);
  const pickRequestsRef = useRef<Record<string, "A" | "B" | "C" | "D">>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const negativeInputRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const imageInputs = MODEL_UI[model]?.imageInputs ?? 0;
  const [numImages, setNumImages] = useState<number>(1);
  const [isMultiPromptEnabled, setIsMultiPromptEnabled] = useState<boolean>(true);
  const [isNegativePromptEnabled, setIsNegativePromptEnabled] = useState<boolean>(false);
  const [sizeSelection, setSizeSelection] = useState<string>("");
  const supportsNumImages = model === "flux-schnell" || model === "flux-pro-ultra"; // flux-schnell and flux-pro-ultra support multi-images in UI
  const supportsNegativePrompt = model.startsWith("kling2.1-"); // Kling models support negative prompts
  const sizeConfig = SIZE_CONFIGS[model];
  const supportsSizeControl = Boolean(sizeConfig);
  const [modelCosts, setModelCosts] = useState<Record<string, number>>({});

  // Auto-grow the textarea up to the visual cap (Tailwind max-h-64 ≈ 16rem)
  const adjustTextareaSize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const rootFont = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const maxPx = 16 * rootFont; // 16rem (Tailwind 64)
    const next = Math.min(el.scrollHeight, Math.floor(maxPx));
    el.style.height = `${next}px`;
  }, []);

  const adjustNegativeTextareaSize = useCallback(() => {
    const el = negativeInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const rootFont = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const maxPx = 16 * rootFont; // 16rem (Tailwind 64)
    const next = Math.min(el.scrollHeight, Math.floor(maxPx));
    el.style.height = `${next}px`;
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (disabled) return;
      // Compute current input/image requirements locally to avoid TDZ issues
      const needsTwo = imageInputs === 2 && model === "flux-multi";
      const needsFour = imageInputs === 4 && model === "kling2.1-multi-i2v";
      const needsOne = imageInputs === 1 && model !== "hailou" && model !== "seedance" && model !== "veo"; // optional for hailou, seedance, and veo
      const hasBoth = !!(imageA?.url && imageB?.url);
      const hasOneImg = !!imageA?.url;
      const hasAtLeastTwo = hasBoth;
      const imageCount = [imageA, imageB, imageC, imageD].filter(img => img?.url).length;
      
      if (needsOne && !hasOneImg) return;
      if (needsTwo && !hasBoth) return;
      if (needsFour && imageCount < 2) return; // Multi needs at least 2 images

      // Check concurrency limit before dispatching
      const toStart = isMultiPromptEnabled 
        ? inputValue.split(/\r?\n/).map(l => l.trim()).filter(Boolean).length 
        : 1;
      
      if (toStart > 0 && pendingCount + toStart > 5 && onRequestOverLimitApproval) {
        const approved = await onRequestOverLimitApproval({ 
          toStart, 
          projectedTotal: pendingCount + toStart 
        });
        if (!approved) return;
      }

      // Check high-spend threshold
      if (estimatedCostCents !== null && spendConfirmThresholdCents && estimatedCostCents >= spendConfirmThresholdCents && onRequestHighSpendApproval) {
        const imagesPerPrompt = supportsNumImages 
          ? Math.max(1, Math.min(3, Math.floor(numImages)))
          : 1;
        const approved = await onRequestHighSpendApproval({
          totalCostCents: estimatedCostCents,
          batchCount,
          imagesPerPrompt,
          modelId: effectiveModelId,
        });
        if (!approved) return;
      }

      if (isMultiPromptEnabled) {
        const lines = inputValue
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length === 0) return;
        
        // Handle negative prompts for multi-prompt mode
        let negativeLines: string[] = [];
        if (isNegativePromptEnabled && supportsNegativePrompt) {
          negativeLines = negativeInputValue
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
          
          // Validation: if we have negative prompts, they must be 1 (reuse for all) or match prompt count
          if (negativeLines.length > 1 && negativeLines.length !== lines.length) {
            return; // Block submit on mismatch
          }
        }
        
        const batchId = typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        for (let idx = 0; idx < lines.length; idx++) {
          const line = lines[idx]!;
          const imagesPerPrompt = supportsNumImages
            ? Math.max(1, Math.min(3, Math.floor(numImages)))
            : 1;
          const payload: PromptPayload = { prompt: line, model, numImages: imagesPerPrompt, batchId, batchIndex: idx, batchTotal: lines.length };
        
        // Add size/resolution parameters based on model and selection
        if (sizeConfig && sizeSelection && sizeSelection !== "auto") {
          if (sizeConfig.type === "imageSize") {
            payload.imageSize = sizeSelection as any;
          } else if (sizeConfig.type === "aspectRatio") {
            payload.aspectRatio = sizeSelection as any;
          } else if (sizeConfig.type === "resolution") {
            payload.resolution = sizeSelection as any;
          }
        }
          
          // Add negative prompt if enabled
          if (isNegativePromptEnabled && supportsNegativePrompt) {
            if (negativeLines.length === 1) {
              payload.negativePrompt = negativeLines[0];
            } else if (negativeLines.length > 1) {
              payload.negativePrompt = negativeLines[idx];
            }
          }
          
          if (imageInputs > 0) {
            payload.imageA = imageA;
            payload.imageB = imageB;
            payload.imageC = imageC;
            payload.imageD = imageD;
          }
          // Dispatch asynchronously to ensure parallel execution
          queueMicrotask(() => onSubmit(payload));
        }
      } else {
        const promptText = inputValue.trim();
        if (!promptText) return;
        const imagesPerPrompt = supportsNumImages
          ? Math.max(1, Math.min(3, Math.floor(numImages)))
          : 1;
        const payload: PromptPayload = { prompt: promptText, model, numImages: imagesPerPrompt };
        
        // Add size/resolution parameters based on model and selection
        if (sizeConfig && sizeSelection && sizeSelection !== "auto") {
          if (sizeConfig.type === "imageSize") {
            payload.imageSize = sizeSelection as any;
          } else if (sizeConfig.type === "aspectRatio") {
            payload.aspectRatio = sizeSelection as any;
          } else if (sizeConfig.type === "resolution") {
            payload.resolution = sizeSelection as any;
          }
        }
        
        // Add negative prompt if enabled
        if (isNegativePromptEnabled && supportsNegativePrompt) {
          const negativeText = negativeInputValue.trim();
          if (negativeText) {
            payload.negativePrompt = negativeText;
          }
        }
        
        if (imageInputs > 0) {
          payload.imageA = imageA;
          payload.imageB = imageB;
          payload.imageC = imageC;
          payload.imageD = imageD;
        }
        onSubmit(payload);
      }

      // Ensure input remains focused so Enter can be pressed repeatedly
      requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true });
      });
    },
    [inputValue, negativeInputValue, onSubmit, model, imageA, imageB, imageC, imageD, imageInputs, supportsNumImages, numImages, disabled, isMultiPromptEnabled, isNegativePromptEnabled, supportsNegativePrompt, sizeConfig, sizeSelection, pendingCount, onRequestOverLimitApproval, spendConfirmThresholdCents, onRequestHighSpendApproval]
  );

  // Listen for image pick results from Canvas
  useEffect(() => {
    const onPicked = (e: Event) => {
      const { requestId, id, url, width, height } = (e as CustomEvent).detail || {};
      if (!requestId) return;
      const slot = pickRequestsRef.current[requestId];
      if (!slot) return;
      const picked: PickedImage = { id, url, width, height };
      if (slot === "A") setImageA(picked);
      if (slot === "B") setImageB(picked);
      if (slot === "C") setImageC(picked);
      if (slot === "D") setImageD(picked);
      delete pickRequestsRef.current[requestId];
      setPendingSlot(null);
    };
    const onCancelled = (e: Event) => {
      const { requestId } = (e as CustomEvent).detail || {};
      if (requestId && pickRequestsRef.current[requestId]) {
        delete pickRequestsRef.current[requestId];
      }
      setPendingSlot(null);
    };
    window.addEventListener("lupe:image-picked", onPicked as EventListener);
    window.addEventListener("lupe:pick-cancelled", onCancelled as EventListener);
    return () => {
      window.removeEventListener("lupe:image-picked", onPicked as EventListener);
      window.removeEventListener("lupe:pick-cancelled", onCancelled as EventListener);
    };
  }, []);

  // Blur the prompt textarea when an image is selected on the canvas
  useEffect(() => {
    const onBlurPrompt = () => {
      try { inputRef.current?.blur(); } catch {}
    };
    window.addEventListener("lupe:blur-prompt", onBlurPrompt as EventListener);
    return () => {
      window.removeEventListener("lupe:blur-prompt", onBlurPrompt as EventListener);
    };
  }, []);

  // Adjust textarea height on mount and whenever content changes
  useEffect(() => {
    adjustTextareaSize();
  }, [inputValue, adjustTextareaSize, isNegativePromptEnabled]);

  useEffect(() => {
    adjustNegativeTextareaSize();
  }, [negativeInputValue, adjustNegativeTextareaSize]);

  const requestPick = useCallback((slot: "A" | "B" | "C" | "D") => {
    const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pickRequestsRef.current[requestId] = slot;
    setPendingSlot(slot);
    window.dispatchEvent(new CustomEvent("lupe:pick-image", { detail: { requestId } }));
  }, []);

  const isEmpty = inputValue.trim().length === 0;
  const needsTwoImages = imageInputs === 2 && model === "flux-multi";
  const needsFourImages = imageInputs === 4 && model === "kling2.1-multi-i2v";
  const needsOneImage = imageInputs === 1 && model !== "hailou" && model !== "seedance" && model !== "veo"; // optional for hailou, seedance, and veo
  const hasBothImages = !!(imageA?.url && imageB?.url);
  const hasOneImage = !!imageA?.url;
  const imageCount = [imageA, imageB, imageC, imageD].filter(img => img?.url).length;
  
  // Check for negative prompt mismatch in multi-prompt mode
  const hasNegativeMismatch = (() => {
    if (!isMultiPromptEnabled || !isNegativePromptEnabled || !supportsNegativePrompt) return false;
    const promptLines = inputValue.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const negativeLines = negativeInputValue.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    return negativeLines.length > 1 && negativeLines.length !== promptLines.length;
  })();
  // For estimation purposes, treat empty input as a single run (so cost isn't $0.00)
  const batchCount = (() => {
    if (!isMultiPromptEnabled) return 1;
    const count = inputValue
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean).length;
    return Math.max(1, count);
  })();
  const modelVariantLabel = (
    model === "hailou" ? (hasOneImage ? "Fast" : "Standard") :
    model === "seedance" ? "Pro" :
    model === "veo" ? "Fast" :
    null
  );

  // Determine effective model ID for cost calculation (mirrors app/page.tsx routing logic)
  const effectiveModelId = useMemo(() => {
    if (model === "hailou") {
      return hasOneImage ? "hailou-fast-i2v" : "hailou-standard-t2v";
    }
    if (model === "seedance") {
      return hasOneImage ? "seedance-pro-i2v" : "seedance-pro-t2v";
    }
    if (model === "veo") {
      return hasOneImage ? "veo-fast-i2v" : "veo-fast-t2v";
    }
    // New Kling models use their model ID directly
    return model;
  }, [model, hasOneImage]);

  // Calculate estimated cost
  const estimatedCostCents = useMemo(() => {
    const baseCost = modelCosts[effectiveModelId];
    if (typeof baseCost !== "number") return null;
    
    const imagesPerPrompt = supportsNumImages 
      ? Math.max(1, Math.min(3, Math.floor(numImages)))
      : 1;
    
    return baseCost * batchCount * imagesPerPrompt;
  }, [modelCosts, effectiveModelId, batchCount, supportsNumImages, numImages]);

  const renderImageField = (label: string, value: PickedImage | null, onClear: () => void, onSelect: () => void) => (
    <div className="flex items-center gap-2 rounded-md bg-neutral-800/60 px-2 py-1 ring-1 ring-white/10">
      <span className="text-xs text-neutral-300 min-w-[52px]">{label}</span>
      {value?.url ? (
        <img src={value.url} alt="" className="h-6 w-6 rounded object-cover" />
      ) : (
        <div className="h-6 w-6 rounded bg-neutral-700/80" />
      )}
      <button
        type="button"
        className="rounded-sm bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={onSelect}
        disabled={disabled}
        aria-label={`Select ${label.toLowerCase()} from screen`}
      >
        Select
      </button>
      <button
        type="button"
        className="rounded-sm bg-white/5 px-2 py-1 text-xs text-white/80 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={onClear}
        disabled={disabled || !value}
        aria-label={`Clear ${label.toLowerCase()}`}
      >
        Clear
      </button>
    </div>
  );

  // Clear selected images and pending state if current model does not use them
  useEffect(() => {
    if (imageInputs === 0) {
      if (imageA) setImageA(null);
      if (imageB) setImageB(null);
      if (imageC) setImageC(null);
      if (imageD) setImageD(null);
      if (pendingSlot) setPendingSlot(null);
    } else if (imageInputs < 4) {
      if (imageD) setImageD(null);
      if (imageInputs < 3 && imageC) setImageC(null);
      if (imageInputs < 2 && imageB) setImageB(null);
    }
  }, [imageInputs, imageA, imageB, imageC, imageD, pendingSlot]);

  // Clear negative prompt settings when switching away from Kling models
  useEffect(() => {
    if (!supportsNegativePrompt) {
      setIsNegativePromptEnabled(false);
      setNegativeInputValue("");
    }
  }, [supportsNegativePrompt]);

  // Initialize size selection when model changes
  useEffect(() => {
    if (sizeConfig) {
      setSizeSelection(sizeConfig.default);
    } else {
      setSizeSelection("");
    }
  }, [model, sizeConfig]);

  // Fetch model costs on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/credits/model-costs", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.costs && typeof data.costs === "object") {
          setModelCosts(data.costs);
        }
      } catch (error) {
        console.warn("Failed to fetch model costs:", error);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <form
      ref={formRef}
      data-ui-overlay="true"
      onSubmit={handleSubmit}
      className="pointer-events-auto flex w-full flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 shadow-lg"
      aria-label="Prompt input form"
    >
      <div className="flex items-center gap-2">
        <label className="text-xs text-neutral-300" htmlFor="model-select">Model</label>
        <select
          id="model-select"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="rounded-md bg-neutral-800 px-2 py-1 text-sm text-neutral-100 ring-1 ring-white/10 focus:outline-none"
          aria-label="Model selector"
        >
          <option value="flux-schnell">flux-schnell</option>
          <option value="flux-kontext-max">flux-kontext-max</option>
          <option value="flux-multi">flux-multi</option>
          <option value="flux-pro-ultra">flux-pro-ultra</option>
          <option value="seedance">seedance</option>
          <option value="hailou">hailou</option>
          <option value="veo">veo</option>
          <option value="kling2.1-standard-i2v">kling2.1-standard-i2v</option>
          <option value="kling2.1-master-i2v">kling2.1-master-i2v</option>
          <option value="kling2.1-pro-i2v">kling2.1-pro-i2v</option>
          <option value="kling2.1-multi-i2v">kling2.1-multi-i2v</option>
        </select>
        {supportsSizeControl ? (
          <>
            <label className="text-xs text-neutral-300" htmlFor="size-select">{sizeConfig.label}</label>
            <select
              id="size-select"
              value={sizeSelection}
              onChange={(e) => setSizeSelection(e.target.value)}
              className="rounded-md bg-neutral-800 px-2 py-1 text-sm text-neutral-100 ring-1 ring-white/10 focus:outline-none disabled:opacity-50"
              aria-label={sizeConfig.label}
              disabled={disabled}
            >
              {sizeConfig.options.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {supportsNumImages ? (
          <>
            <label className="text-xs text-neutral-300" htmlFor="num-images-select">Images</label>
            <select
              id="num-images-select"
              value={numImages}
              onChange={(e) => setNumImages(Number(e.target.value))}
              className="w-[64px] rounded-md bg-neutral-800 px-2 py-1 text-sm text-neutral-100 ring-1 ring-white/10 focus:outline-none disabled:opacity-50"
              aria-label="Images per prompt"
              disabled={disabled}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </>
        ) : null}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="multi-prompt-toggle"
            checked={isMultiPromptEnabled}
            onChange={(e) => setIsMultiPromptEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-600 bg-neutral-800 text-neutral-100 focus:ring-2 focus:ring-neutral-500"
            disabled={disabled}
          />
          <label className="text-xs text-neutral-300" htmlFor="multi-prompt-toggle">
            Multi prompts (line breaks)
          </label>
        </div>
        {supportsNegativePrompt && (
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="negative-prompt-toggle"
              checked={isNegativePromptEnabled}
              onChange={(e) => setIsNegativePromptEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-neutral-600 bg-neutral-800 text-neutral-100 focus:ring-2 focus:ring-neutral-500"
              disabled={disabled}
            />
            <label className="text-xs text-neutral-300" htmlFor="negative-prompt-toggle">
              Negative prompt
            </label>
          </div>
        )}
        <div className="ml-auto text-xs text-neutral-400">
          {imageInputs > 0 && pendingSlot ? `Click an image on the canvas to set Image ${pendingSlot}… (Esc to cancel)` : null}
        </div>
      </div>

      {imageInputs > 0 ? (
        <div className="flex items-center gap-2">
          {imageInputs >= 1 ? renderImageField(
            "Image A",
            imageA,
            () => setImageA(null),
            () => requestPick("A")
          ) : null}
          {imageInputs >= 2 ? renderImageField(
            "Image B",
            imageB,
            () => setImageB(null),
            () => requestPick("B")
          ) : null}
          {imageInputs >= 3 ? renderImageField(
            "Image C",
            imageC,
            () => setImageC(null),
            () => requestPick("C")
          ) : null}
          {imageInputs >= 4 ? renderImageField(
            "Image D",
            imageD,
            () => setImageD(null),
            () => requestPick("D")
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        {isNegativePromptEnabled && supportsNegativePrompt ? (
          <div className="grid grid-cols-[2fr_1fr] gap-2 flex-1">
            <div className="flex flex-col">
              <label className="text-xs text-neutral-300 mb-1">Prompt</label>
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onInput={adjustTextareaSize}
                onKeyDown={(e) => {
                  if ((e as any).isComposing || (e.nativeEvent as any)?.isComposing) return;
                  if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    e.preventDefault();
                    // Mirror the submit button disabled conditions
                    const blocked =
                      disabled ||
                      isEmpty ||
                      hasNegativeMismatch ||
                      (needsTwoImages && !hasBothImages) ||
                      (needsFourImages && imageCount < 2) ||
                      (needsOneImage && !hasOneImage);
                    if (!blocked) formRef.current?.requestSubmit();
                  }
                }}
                className="min-w-0 bg-transparent text-neutral-100 placeholder-neutral-400 outline-none resize-none max-h-64 overflow-y-auto"
                placeholder={isMultiPromptEnabled ? "Enter your prompt. To run multiple prompts, separate them with line breaks." : "Type a prompt"}
                aria-label="Prompt"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                rows={2}
                autoFocus
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-neutral-300 mb-1">Negative prompt</label>
              <textarea
                ref={negativeInputRef}
                value={negativeInputValue}
                onChange={(e) => setNegativeInputValue(e.target.value)}
                onInput={adjustNegativeTextareaSize}
                onKeyDown={(e) => {
                  if ((e as any).isComposing || (e.nativeEvent as any)?.isComposing) return;
                  if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    e.preventDefault();
                    // Mirror the submit button disabled conditions
                    const blocked =
                      disabled ||
                      isEmpty ||
                      hasNegativeMismatch ||
                      (needsTwoImages && !hasBothImages) ||
                      (needsFourImages && imageCount < 2) ||
                      (needsOneImage && !hasOneImage);
                    if (!blocked) formRef.current?.requestSubmit();
                  }
                }}
                className="min-w-0 bg-transparent text-neutral-100 placeholder-neutral-400 outline-none resize-none max-h-64 overflow-y-auto"
                placeholder={isMultiPromptEnabled ? "Enter negative prompt. For multiple, separate with line breaks." : "Enter negative prompt"}
                aria-label="Negative prompt"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                rows={2}
              />
            </div>
          </div>
        ) : (
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onInput={adjustTextareaSize}
            onKeyDown={(e) => {
              if ((e as any).isComposing || (e.nativeEvent as any)?.isComposing) return;
              if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                // Mirror the submit button disabled conditions
                const blocked =
                  disabled ||
                  isEmpty ||
                  (needsTwoImages && !hasBothImages) ||
                  (needsFourImages && imageCount < 2) ||
                  (needsOneImage && !hasOneImage);
                if (!blocked) formRef.current?.requestSubmit();
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-neutral-100 placeholder-neutral-400 outline-none resize-none max-h-64 overflow-y-auto"
            placeholder={isMultiPromptEnabled ? "Enter your prompt. To run multiple prompts, separate them with line breaks." : "Type a prompt"}
            aria-label="Prompt"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            rows={2}
            autoFocus
          />
        )}
        <div className="flex flex-col items-end">
          {hasNegativeMismatch && (
            <div className="mb-1 text-[10px] text-red-400">
              Negative prompt count must match prompt count
            </div>
          )}
          {estimatedCostCents !== null ? (
            <div className="mb-1 text-[10px] font-mono text-neutral-400">
              Est. cost: ${(estimatedCostCents / 100).toFixed(2)}
            </div>
          ) : (
            <div className="mb-1 text-[10px] font-mono text-neutral-500">
              Est. cost: —
            </div>
          )}
          {modelVariantLabel ? (
            <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">
              {modelVariantLabel}
            </div>
          ) : null}
          <button
            type="submit"
            aria-label="Submit prompt"
            className="rounded-md bg-neutral-800 px-3 py-2 text-sm font-medium text-neutral-100 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={
              disabled ||
              isEmpty ||
              hasNegativeMismatch ||
              (needsTwoImages && !hasBothImages) ||
              (needsFourImages && imageCount < 2) ||
              (needsOneImage && !hasOneImage)
            }
          >
            {isMultiPromptEnabled && batchCount > 1 ? `Generate ${batchCount}` : "Enter"}
          </button>
        </div>
      </div>
    </form>
  );
}
