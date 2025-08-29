"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import Canvas from "@/components/canvas/Canvas";
import ProjectsSidebar from "@/components/projects/ProjectsSidebar";
import PromptForm, { PromptPayload } from "@/components/chat/PromptForm";
import NoPageZoom from "@/components/system/NoPageZoom";
import LoginBanner from "@/components/auth/LoginBanner";
import GridBackground from "@/components/canvas/GridBackground";
import { Share2, User } from "lucide-react";

const MAX_CONCURRENT_PROMPTS = 5;
const SPEND_CONFIRM_THRESHOLD_CENTS = 700; // $7.00

export default function Page() {
  const { user, loading, signInWithGoogle, signOut } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  // Removed sparkle overlay
  const [showLoginBanner, setShowLoginBanner] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [shareInfo, setShareInfo] = useState<{ isPublic: boolean; slug: string | null } | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const profileRef = useRef<HTMLDivElement | null>(null);
  // Removed sparkle overlay timer
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [approvalDialog, setApprovalDialog] = useState<{
    isOpen: boolean;
    toStart: number;
    projectedTotal: number;
    resolver: ((approved: boolean) => void) | null;
  }>({ isOpen: false, toStart: 0, projectedTotal: 0, resolver: null });
  const [spendDialog, setSpendDialog] = useState<{
    isOpen: boolean;
    amountCents: number;
    batchCount: number;
    imagesPerPrompt: number;
    modelId: string;
    resolver: ((approved: boolean) => void) | null;
  }>({ isOpen: false, amountCents: 0, batchCount: 0, imagesPerPrompt: 0, modelId: "", resolver: null });
  useEffect(() => {
    const key = "lupe:selected-project-id";
    const existing = localStorage.getItem(key);
    if (existing) setSelectedProjectId(existing);
  }, []);
  useEffect(() => {
    const key = "lupe:selected-project-id";
    if (selectedProjectId) localStorage.setItem(key, selectedProjectId);
  }, [selectedProjectId]);
  // Ensure a default project selection for authenticated users
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id) return;
      if (selectedProjectId) return;
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        if (res.status === 401) return;
        const data = await res.json();
        const projects = Array.isArray(data?.projects) ? data.projects as Array<{ id: string }> : [];
        if (projects.length > 0) {
          if (!cancelled) setSelectedProjectId(projects[0]!.id);
          return;
        }
        // Create one if none exist
        const make = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Untitled" }) });
        if (!make.ok) return;
        const created = await make.json();
        const proj = created?.project as { id: string } | undefined;
        if (proj && !cancelled) setSelectedProjectId(proj.id);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [user?.id, selectedProjectId]);

  // Track share status of the selected canvas
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id || !selectedProjectId) {
        setShareInfo(null);
        return;
      }
      try {
        const res = await fetch(`/api/canvases/${selectedProjectId}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const isPublic = Boolean(data?.is_public);
        const slug = (data?.public_slug ?? null) as string | null;
        if (!cancelled) setShareInfo({ isPublic, slug });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [user?.id, selectedProjectId]);

  const enableShare = async () => {
    if (!selectedProjectId || shareBusy) return;
    try {
      setShareBusy(true);
      const res = await fetch(`/api/canvases/${selectedProjectId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enable: true }),
      });
      const data = await res.json();
      const slug = data?.slug as string | undefined;
      if (res.ok && slug) {
        setShareInfo({ isPublic: true, slug });
        const url = `${location.origin}/c/${slug}`;
        try { await navigator.clipboard.writeText(url); } catch {}
      }
    } finally {
      setShareBusy(false);
    }
  };

  const disableShare = async () => {
    if (!selectedProjectId || shareBusy) return;
    try {
      setShareBusy(true);
      const res = await fetch(`/api/canvases/${selectedProjectId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enable: false }),
      });
      if (res.ok) setShareInfo({ isPublic: false, slug: null });
    } finally {
      setShareBusy(false);
    }
  };

  const copyShareLink = async () => {
    const slug = shareInfo?.slug;
    if (!slug) return;
    const url = `${location.origin}/c/${slug}`;
    try { await navigator.clipboard.writeText(url); } catch {}
  };

  // Helper to log generated assets
  const logGeneratedAssets = async (
    payload: PromptPayload,
    effectiveModelId: string,
    images: Array<{ url: string; width?: number; height?: number }>,
    videoUrl?: string
  ) => {
    // Do not gate on client auth state; server will enforce auth
    try {
      // Collect input image URLs (only http(s))
      const inputImageUrls: string[] = [];
      if (payload.imageA?.url && /^https?:\/\//i.test(payload.imageA.url)) {
        inputImageUrls.push(payload.imageA.url);
      }
      if (payload.imageB?.url && /^https?:\/\//i.test(payload.imageB.url)) {
        inputImageUrls.push(payload.imageB.url);
      }
      if (payload.imageC?.url && /^https?:\/\//i.test(payload.imageC.url)) {
        inputImageUrls.push(payload.imageC.url);
      }
      if (payload.imageD?.url && /^https?:\/\//i.test(payload.imageD.url)) {
        inputImageUrls.push(payload.imageD.url);
      }

      // Collect parameters used
      const params: Record<string, any> = {};
      if (payload.numImages && payload.numImages > 1) {
        params.num_images = payload.numImages;
      }
      if (payload.imageSize) {
        params.image_size = payload.imageSize;
      }
      if (payload.aspectRatio) {
        params.aspect_ratio = payload.aspectRatio;
      }
      if (payload.resolution) {
        params.resolution = payload.resolution;
      }

      // Prepare outputs
      const outputs: Array<{
        kind: "image" | "video";
        url: string;
        width?: number;
        height?: number;
        duration_seconds?: number;
      }> = [];

      // Add image outputs
      for (const img of images) {
        if (!img?.url) continue;
        // Server requires http(s) URLs
        if (!/^https?:\/\//i.test(img.url)) continue;
        const w = Number.isFinite(img.width as number) && (img.width as number) > 0 ? Math.floor(img.width as number) : undefined;
        const h = Number.isFinite(img.height as number) && (img.height as number) > 0 ? Math.floor(img.height as number) : undefined;
        const out: { kind: "image"; url: string; width?: number; height?: number } = { kind: "image", url: img.url };
        if (w !== undefined) out.width = w;
        if (h !== undefined) out.height = h;
        outputs.push(out);
      }

      // Add video output
      if (videoUrl && /^https?:\/\//i.test(videoUrl)) {
        outputs.push({
          kind: "video",
          url: videoUrl,
          // Note: We don't have video dimensions/duration from the response
          // This could be enhanced in the future
        });
      }

      if (outputs.length === 0) return;

      // Fire-and-forget logging call
      fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: effectiveModelId,
          canvas_id: selectedProjectId || undefined,
          prompt: payload.prompt,
          negative_prompt: payload.negativePrompt || undefined,
          params: Object.keys(params).length > 0 ? params : undefined,
          input_image_urls: inputImageUrls.length > 0 ? inputImageUrls : undefined,
          outputs,
        }),
      }).catch((error) => {
        // Silent failure - don't interrupt user experience
        console.warn("Failed to log generated assets:", error);
      });
    } catch (error) {
      console.warn("Error preparing asset log:", error);
    }
  };

  const handleOverLimitApproval = async (info: { toStart: number; projectedTotal: number }): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setApprovalDialog({
        isOpen: true,
        toStart: info.toStart,
        projectedTotal: info.projectedTotal,
        resolver: resolve,
      });
    });
  };

  const handleApprovalResponse = (approved: boolean) => {
    if (approvalDialog.resolver) {
      approvalDialog.resolver(approved);
    }
    setApprovalDialog({ isOpen: false, toStart: 0, projectedTotal: 0, resolver: null });
  };

  const handleSpendApproval = async (info: { totalCostCents: number; batchCount: number; imagesPerPrompt: number; modelId: string }): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setSpendDialog({
        isOpen: true,
        amountCents: info.totalCostCents,
        batchCount: info.batchCount,
        imagesPerPrompt: info.imagesPerPrompt,
        modelId: info.modelId,
        resolver: resolve,
      });
    });
  };

  const handleSpendResponse = (approved: boolean) => {
    if (spendDialog.resolver) {
      spendDialog.resolver(approved);
    }
    setSpendDialog({ isOpen: false, amountCents: 0, batchCount: 0, imagesPerPrompt: 0, modelId: "", resolver: null });
  };

  const handlePrompt = async (payload: PromptPayload) => {
    // Backstop check for concurrency limit
    if (pendingCount >= MAX_CONCURRENT_PROMPTS) {
      const approved = await handleOverLimitApproval({ 
        toStart: 1, 
        projectedTotal: pendingCount + 1 
      });
      if (!approved) return;
    }
    
    // Compute placeholder dimensions based on model and parameters
    const computePlaceholderSize = (model: string, payload: PromptPayload): { width: number; height: number } => {
      if (model === "flux-schnell") {
        const imageSize = payload.imageSize || "landscape_4_3";
        switch (imageSize) {
          case "square": return { width: 512, height: 512 };
          case "square_hd": return { width: 768, height: 768 };
          case "portrait_4_3": return { width: 480, height: 640 };
          case "portrait_16_9": return { width: 360, height: 640 };
          case "landscape_16_9": return { width: 960, height: 540 };
          case "landscape_4_3":
          default: return { width: 800, height: 600 };
        }
      } else if (model === "flux-pro-ultra" || model === "flux-kontext-max" || model === "flux-multi") {
        const aspectRatio = payload.aspectRatio || "4:3";
        switch (aspectRatio) {
          case "1:1": return { width: 600, height: 600 };
          case "16:9": return { width: 960, height: 540 };
          case "9:16": return { width: 540, height: 960 };
          case "3:2": return { width: 720, height: 480 };
          case "2:3": return { width: 480, height: 720 };
          case "3:4": return { width: 480, height: 640 };
          case "21:9": return { width: 1050, height: 450 };
          case "9:21": return { width: 450, height: 1050 };
          case "4:3":
          default: return { width: 800, height: 600 };
        }
      } else {
        // Video models
        return { width: 640, height: 360 };
      }
    };
    
    const isVideoModel = ["hailou", "seedance", "veo", "kling2.1-standard-i2v", "kling2.1-master-i2v", "kling2.1-pro-i2v", "kling2.1-multi-i2v"].includes(payload.model);
    const placeholderSize = computePlaceholderSize(payload.model, payload);
    const numImages = (payload.model === "flux-schnell" || payload.model === "flux-pro-ultra")
      ? Math.max(1, Math.min(3, Math.floor(payload.numImages ?? 1)))
      : 1;
    
    // Generate placeholder IDs and dispatch placeholders before network call
    const placeholderIds: string[] = [];
    const requestGroupId = payload.batchId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const batchIndex = typeof payload.batchIndex === "number" ? payload.batchIndex : 0;
    const batchTotal = typeof payload.batchTotal === "number" ? payload.batchTotal : 1;
    
    if (isVideoModel) {
      const placeholderId = `vid-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      placeholderIds.push(placeholderId);
      window.dispatchEvent(
        new CustomEvent("lupe:add-placeholder", {
          detail: {
            id: placeholderId,
            kind: "video",
            width: placeholderSize.width,
            height: placeholderSize.height,
            prompt: payload.prompt,
          },
        })
      );
    } else {
      for (let i = 0; i < numImages; i++) {
        const placeholderId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 9)}-${i}`;
        placeholderIds.push(placeholderId);
        window.dispatchEvent(
          new CustomEvent("lupe:add-placeholder", {
            detail: {
              id: placeholderId,
              kind: "image",
              width: placeholderSize.width,
              height: placeholderSize.height,
              __group: { requestGroupId, column: batchIndex, row: i, totalColumns: batchTotal },
              prompt: payload.prompt,
            },
          })
        );
      }
    }
    
    try {
      // Require authentication for gated models only; allow flux-schnell when logged out
      if (!user && !loading && payload.model !== "flux-schnell") {
        setShowLoginBanner(true);
        // Clean up placeholders on auth failure
        placeholderIds.forEach(id => {
          window.dispatchEvent(new CustomEvent("lupe:remove-placeholder", { detail: { id } }));
        });
        return;
      }

      setPendingCount((prev) => prev + 1);
      // Yield to next frame so the overlay paints before the network request
      // Skip delay for batched requests to enable parallel execution
      if (!payload.batchId) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      let res: Response;
      const numImages = (payload.model === "flux-schnell" || payload.model === "flux-pro-ultra")
        ? Math.max(1, Math.min(3, Math.floor(payload.numImages ?? 1)))
        : 1; // clamp to 1 for non-schnell/pro-ultra models
      if (payload.model === "flux-multi") {
        const images = [payload.imageA, payload.imageB, payload.imageC, payload.imageD]
          .filter(img => img?.url)
          .map(img => img!.url);
        
        const toDataOrHttp = async (u: string): Promise<string> => {
          if (!u) return "";
          if (/^https?:\/\//i.test(u) || /^data:/i.test(u)) return u;
          if (u.startsWith("blob:")) {
            try {
              const resp = await fetch(u);
              const blob = await resp.blob();
              const reader = new FileReader();
              const dataUrl = await new Promise<string>((resolve, reject) => {
                reader.onerror = () => reject(reader.error);
                reader.onload = () => resolve(String(reader.result || ""));
                reader.readAsDataURL(blob);
              });
              return dataUrl;
            } catch {
              return u; // last resort; server will validate
            }
          }
          return u;
        };
        
        const image_urls = await Promise.all(images.map(toDataOrHttp));
        
        // Infer aspect ratio from Image A orientation to match inputs by default
        const aW = payload.imageA?.width ?? 0;
        const aH = payload.imageA?.height ?? 0;
        const aspect_ratio = aW && aH ? (aH > aW ? "3:4" : aW > aH ? "4:3" : "1:1") : "3:4";
        res = await fetch("/api/flux-multi", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: payload.prompt,
            image_urls,
            guidance_scale: 3.5,
            num_images: numImages,
            output_format: "jpeg",
            aspect_ratio: payload.aspectRatio || aspect_ratio,
          }),
        });
      } else if (payload.model === "flux-kontext-max") {
        const urlA = payload.imageA?.url || "";
        const toDataOrHttp = async (u: string): Promise<string> => {
          if (!u) return "";
          if (/^https?:\/\//i.test(u) || /^data:/i.test(u)) return u;
          if (u.startsWith("blob:")) {
            try {
              const resp = await fetch(u);
              const blob = await resp.blob();
              const reader = new FileReader();
              const dataUrl = await new Promise<string>((resolve, reject) => {
                reader.onerror = () => reject(reader.error);
                reader.onload = () => resolve(String(reader.result || ""));
                reader.readAsDataURL(blob);
              });
              return dataUrl;
            } catch {
              return u; // last resort; server will validate
            }
          }
          return u;
        };
        const inA = await toDataOrHttp(urlA);
        const aW = payload.imageA?.width ?? 0;
        const aH = payload.imageA?.height ?? 0;
        const aspect_ratio = aW && aH ? (aH > aW ? "3:4" : aW > aH ? "4:3" : "1:1") : "3:4";
        res = await fetch("/api/flux-kontext-max", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: payload.prompt,
            image_url: inA,
            guidance_scale: 3.5,
            num_images: numImages,
            output_format: "jpeg",
            aspect_ratio: payload.aspectRatio || aspect_ratio,
          }),
        });
      } else if (payload.model === "seedance") {
        const hasImage = Boolean(payload.imageA?.url);
        if (hasImage) {
          const urlA = payload.imageA?.url || "";
          const toDataOrHttp = async (u: string): Promise<string> => {
            if (!u) return "";
            if (/^https?:\/\//i.test(u) || /^data:/i.test(u)) return u;
            if (u.startsWith("blob:")) {
              try {
                const resp = await fetch(u);
                const blob = await resp.blob();
                const reader = new FileReader();
                const dataUrl = await new Promise<string>((resolve, reject) => {
                  reader.onerror = () => reject(reader.error);
                  reader.onload = () => resolve(String(reader.result || ""));
                  reader.readAsDataURL(blob);
                });
                return dataUrl;
              } catch {
                return u;
              }
            }
            return u;
          };
          const inA = await toDataOrHttp(urlA);
          res = await fetch("/api/seedance-pro-i2v", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: payload.prompt,
              image_url: inA,
              resolution: payload.resolution || "480p",
            }),
          });
        } else {
          res = await fetch("/api/seedance-pro-t2v", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: payload.prompt,
              resolution: payload.resolution || "480p",
            }),
          });
        }
      } else if (payload.model === "hailou") {
        const hasImage = Boolean(payload.imageA?.url);
        if (hasImage) {
          const urlA = payload.imageA?.url || "";
          const toDataOrHttp = async (u: string): Promise<string> => {
            if (!u) return "";
            if (/^https?:\/\//i.test(u) || /^data:/i.test(u)) return u;
            if (u.startsWith("blob:")) {
              try {
                const resp = await fetch(u);
                const blob = await resp.blob();
                const reader = new FileReader();
                const dataUrl = await new Promise<string>((resolve, reject) => {
                  reader.onerror = () => reject(reader.error);
                  reader.onload = () => resolve(String(reader.result || ""));
                  reader.readAsDataURL(blob);
                });
                return dataUrl;
              } catch {
                return u;
              }
            }
            return u;
          };
          const inA = await toDataOrHttp(urlA);
          res = await fetch("/api/hailou-fast-i2v", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: payload.prompt,
              image_url: inA,
            }),
          });
        } else {
          res = await fetch("/api/hailou-standard-t2v", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: payload.prompt,
            }),
          });
        }
      } else if (payload.model === "veo") {
        const hasImage = Boolean(payload.imageA?.url);
        if (hasImage) {
          const urlA = payload.imageA?.url || "";
          const toDataOrHttp = async (u: string): Promise<string> => {
            if (!u) return "";
            if (/^https?:\/\//i.test(u) || /^data:/i.test(u)) return u;
            if (u.startsWith("blob:")) {
              try {
                const resp = await fetch(u);
                const blob = await resp.blob();
                const reader = new FileReader();
                const dataUrl = await new Promise<string>((resolve, reject) => {
                  reader.onerror = () => reject(reader.error);
                  reader.onload = () => resolve(String(reader.result || ""));
                  reader.readAsDataURL(blob);
                });
                return dataUrl;
              } catch {
                return u;
              }
            }
            return u;
          };
          const inA = await toDataOrHttp(urlA);
          res = await fetch("/api/veo-fast-i2v", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: payload.prompt,
              image_url: inA,
              ...(payload.resolution ? { resolution: payload.resolution } : {}),
            }),
          });
        } else {
          res = await fetch("/api/veo-fast-t2v", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: payload.prompt,
              ...(payload.resolution ? { resolution: payload.resolution } : {}),
            }),
          });
        }
      } else if (payload.model === "kling2.1-standard-i2v") {
        const urlA = payload.imageA?.url || "";
        const toDataOrHttp = async (u: string): Promise<string> => {
          if (!u) return "";
          if (/^https?:\/\//i.test(u) || /^data:/i.test(u)) return u;
          if (u.startsWith("blob:")) {
            try {
              const resp = await fetch(u);
              const blob = await resp.blob();
              const reader = new FileReader();
              const dataUrl = await new Promise<string>((resolve, reject) => {
                reader.onerror = () => reject(reader.error);
                reader.onload = () => resolve(String(reader.result || ""));
                reader.readAsDataURL(blob);
              });
              return dataUrl;
            } catch {
              return u;
            }
          }
          return u;
        };
        const inA = await toDataOrHttp(urlA);
        res = await fetch("/api/kling2.1-standard-i2v", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: payload.prompt,
            image_url: inA,
            ...(payload.negativePrompt ? { negative_prompt: payload.negativePrompt } : {}),
          }),
        });
      } else if (payload.model === "kling2.1-master-i2v") {
        const urlA = payload.imageA?.url || "";
        const toDataOrHttp = async (u: string): Promise<string> => {
          if (!u) return "";
          if (/^https?:\/\//i.test(u) || /^data:/i.test(u)) return u;
          if (u.startsWith("blob:")) {
            try {
              const resp = await fetch(u);
              const blob = await resp.blob();
              const reader = new FileReader();
              const dataUrl = await new Promise<string>((resolve, reject) => {
                reader.onerror = () => reject(reader.error);
                reader.onload = () => resolve(String(reader.result || ""));
                reader.readAsDataURL(blob);
              });
              return dataUrl;
            } catch {
              return u;
            }
          }
          return u;
        };
        const inA = await toDataOrHttp(urlA);
        res = await fetch("/api/kling2.1-master-i2v", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: payload.prompt,
            image_url: inA,
            ...(payload.negativePrompt ? { negative_prompt: payload.negativePrompt } : {}),
          }),
        });
      } else if (payload.model === "kling2.1-pro-i2v") {
        const urlA = payload.imageA?.url || "";
        const urlB = payload.imageB?.url || "";
        const toDataOrHttp = async (u: string): Promise<string> => {
          if (!u) return "";
          if (/^https?:\/\//i.test(u) || /^data:/i.test(u)) return u;
          if (u.startsWith("blob:")) {
            try {
              const resp = await fetch(u);
              const blob = await resp.blob();
              const reader = new FileReader();
              const dataUrl = await new Promise<string>((resolve, reject) => {
                reader.onerror = () => reject(reader.error);
                reader.onload = () => resolve(String(reader.result || ""));
                reader.readAsDataURL(blob);
              });
              return dataUrl;
            } catch {
              return u;
            }
          }
          return u;
        };
        const inA = await toDataOrHttp(urlA);
        const requestBody: any = {
          prompt: payload.prompt,
          image_url: inA,
          ...(payload.negativePrompt ? { negative_prompt: payload.negativePrompt } : {}),
        };
        
        // Only include tail_image_url if Image B is provided
        if (urlB) {
          const inB = await toDataOrHttp(urlB);
          requestBody.tail_image_url = inB;
        }
        
        res = await fetch("/api/kling2.1-pro-i2v", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
      } else if (payload.model === "kling2.1-multi-i2v") {
        const images = [payload.imageA, payload.imageB, payload.imageC, payload.imageD]
          .filter(img => img?.url)
          .map(img => img!.url);
        
        const toDataOrHttp = async (u: string): Promise<string> => {
          if (!u) return "";
          if (/^https?:\/\//i.test(u) || /^data:/i.test(u)) return u;
          if (u.startsWith("blob:")) {
            try {
              const resp = await fetch(u);
              const blob = await resp.blob();
              const reader = new FileReader();
              const dataUrl = await new Promise<string>((resolve, reject) => {
                reader.onerror = () => reject(reader.error);
                reader.onload = () => resolve(String(reader.result || ""));
                reader.readAsDataURL(blob);
              });
              return dataUrl;
            } catch {
              return u;
            }
          }
          return u;
        };
        
        const input_image_urls = await Promise.all(images.map(toDataOrHttp));
        
        // Infer aspect ratio from first image orientation
        const firstImg = payload.imageA;
        const aW = firstImg?.width ?? 0;
        const aH = firstImg?.height ?? 0;
        const aspect_ratio = aW && aH ? (aH > aW ? "9:16" : aW > aH ? "16:9" : "1:1") : "16:9";
        
        res = await fetch("/api/kling2.1-multi-i2v", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: payload.prompt,
            input_image_urls,
            aspect_ratio: payload.aspectRatio || aspect_ratio,
            ...(payload.negativePrompt ? { negative_prompt: payload.negativePrompt } : {}),
          }),
        });
      } else if (payload.model === "flux-pro-ultra") {
        res = await fetch("/api/flux-pro-ultra", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: payload.prompt,
            num_images: numImages,
            output_format: "jpeg",
            safety_tolerance: "2",
            enhance_prompt: false,
            aspect_ratio: payload.aspectRatio || "4:3",
            sync_mode: false,
          }),
        });
      } else {
        res = await fetch("/api/flux-schnell", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: payload.prompt,
            num_inference_steps: 4,
            acceleration: "regular",
            guidance_scale: 3.5,
            output_format: "jpeg",
            num_images: numImages,
            sync_mode: true,
            image_size: payload.imageSize || { width: 800, height: 600 },
          }),
        });
      }
      if (res.status === 401) {
        setShowLoginBanner(true);
        // Clean up placeholders on auth failure
        placeholderIds.forEach(id => {
          window.dispatchEvent(new CustomEvent("lupe:remove-placeholder", { detail: { id } }));
        });
        return;
      }
      if (res.status === 402) {
        setNotice("Insufficient credits");
        window.setTimeout(() => setNotice(null), 3500);
        // Clean up placeholders on credit failure
        placeholderIds.forEach(id => {
          window.dispatchEvent(new CustomEvent("lupe:remove-placeholder", { detail: { id } }));
        });
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        console.error("Generation error:", data);
        
        // Build user-friendly error message
        let message = "Generation failed.";
        if (data?.error?.code === "BAD_PROMPT") {
          message = "Blocked by model safety filters. Try rephrasing the prompt.";
        } else if (res.status === 502) {
          message = "Model failed to generate. Try again or lower resolution.";
        } else if (data?.error?.message) {
          message = data.error.message;
        }
        
        // Log for debugging
        if (data?.error?.requestId) {
          console.warn("Generation error details:", data.error.code, data.error.requestId);
        }
        
        // Replace placeholders with error elements instead of removing them
        placeholderIds.forEach(id => {
          window.dispatchEvent(new CustomEvent("lupe:replace-with-error", { 
            detail: { id, message } 
          }));
        });
        return;
      }
      const images: Array<{ url: string; width?: number; height?: number }> = Array.isArray(data?.images) ? data.images : [];
      if (images.length > 0) {
        const batchId = payload.batchId || undefined;
        const batchIndex = typeof payload.batchIndex === "number" ? payload.batchIndex : undefined;
        const batchTotal = typeof payload.batchTotal === "number" ? payload.batchTotal : undefined;
        let imageIndex = 0;
        for (const im of images) {
          if (!im?.url) continue;
          const placeholderId = placeholderIds[imageIndex];
          const column = typeof batchIndex === "number" ? batchIndex : 0;
          const row = imageIndex++;
          window.dispatchEvent(
            new CustomEvent("lupe:add-image", {
              detail: { 
                url: im.url, 
                width: im.width, 
                height: im.height, 
                placeholderId,
                __group: { requestGroupId, column, row, totalColumns: batchTotal || 1 }, 
                prompt: payload.prompt 
              },
            })
          );
        }
      }
      const videoUrl: string | undefined = data?.video?.url;
      if (videoUrl) {
        const placeholderId = placeholderIds[0];
        window.dispatchEvent(
          new CustomEvent("lupe:add-video", {
            detail: { url: videoUrl, placeholderId, prompt: payload.prompt },
          })
        );
      }

      // Log generated assets (fire-and-forget)
      if (images.length > 0 || videoUrl) {
        // Determine effective model ID for logging
        const effectiveModelId = (() => {
          if (payload.model === "hailou") {
            return payload.imageA?.url ? "hailou-fast-i2v" : "hailou-standard-t2v";
          }
          if (payload.model === "seedance") {
            return payload.imageA?.url ? "seedance-pro-i2v" : "seedance-pro-t2v";
          }
          if (payload.model === "veo") {
            return payload.imageA?.url ? "veo-fast-i2v" : "veo-fast-t2v";
          }
          return payload.model;
        })();

        void logGeneratedAssets(payload, effectiveModelId, images, videoUrl);
      }
      // Refresh balance after successful generation
      try {
        if (user) {
          const balRes = await fetch("/api/credits/balance", { cache: "no-store" });
          if (balRes.ok) {
            const bal = await balRes.json();
            const cents = Number(bal?.balance_cents);
            if (Number.isFinite(cents)) setBalanceCents(cents);
          }
        }
      } catch {}
    } catch (e) {
      console.error(e);
      // Clean up placeholders on any error
      placeholderIds.forEach(id => {
        window.dispatchEvent(new CustomEvent("lupe:remove-placeholder", { detail: { id } }));
      });
    } finally {
      setPendingCount((prev) => Math.max(0, prev - 1));
    }
  };
  // Fetch balance on login and on project change (project change optional)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) { setBalanceCents(null); return; }
      try {
        const res = await fetch("/api/credits/balance", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const cents = Number(data?.balance_cents);
        if (!cancelled && Number.isFinite(cents)) setBalanceCents(cents);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [user]);
  useEffect(() => {
    if (user) setShowLoginBanner(false);
    if (!user) setSelectedProjectId(null);
  }, [user]);

  // Listen for asset addition success events
  useEffect(() => {
    const handleAssetsAdded = (e: Event) => {
      const { count } = (e as CustomEvent).detail || {};
      if (typeof count === "number" && count > 0) {
        setToastMessage(`Added ${count} asset${count === 1 ? "" : "s"} to canvas`);
        setTimeout(() => setToastMessage(null), 3000);
      }
    };
    
    window.addEventListener("lupe:assets-added", handleAssetsAdded as EventListener);
    return () => window.removeEventListener("lupe:assets-added", handleAssetsAdded as EventListener);
  }, []);

  // Close profile popover on outside click / Esc
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const n = e.target as Node | null;
      if (!profileRef.current || !n) return;
      if (!profileRef.current.contains(n)) setShowProfile(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowProfile(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  
  // Simple landing page for logged-out users
  if (!loading && !user) {
    const LANDING_ASSET_URLS = [
      "https://v3.fal.media/files/rabbit/Syz79CCljUZe-Zf_vYXmD.jpeg",
      "https://v3.fal.media/files/penguin/IqRGHQevhdbvjLF4zHwmk.jpeg",
      "https://v3.fal.media/files/monkey/-uPPj4uBqXzpU-Z6nuNFX.jpeg",
      "https://v3.fal.media/files/monkey/9Z06Wu4qfFfeBYBZDrHlT.jpeg",
      "https://v3.fal.media/files/zebra/Rjyxb5VmX434rjwTSXY0h.jpeg",
    ];

    type Scatter = { topPct: number; leftPct: number; widthPx: number; rotateDeg: number; url: string };
    const generateScatters = (urls: string[]): Scatter[] => {
      const results: Scatter[] = [];
      const minEdge = 6; // keep away from edges
      const centerMin = 26;
      const centerMax = 74; // keep clear area roughly centered
      for (const url of urls) {
        let topPct = 0;
        let leftPct = 0;
        // Try a few times to avoid center CTA area
        for (let i = 0; i < 15; i++) {
          const t = minEdge + Math.random() * (100 - 2 * minEdge);
          const l = minEdge + Math.random() * (100 - 2 * minEdge);
          const inCenter = t > centerMin && t < centerMax && l > centerMin && l < centerMax;
          if (!inCenter) {
            topPct = t;
            leftPct = l;
            break;
          }
        }
        const widthPx = 140 + Math.round(Math.random() * 120);
        const rotateDeg = -10 + Math.random() * 20;
        results.push({ topPct, leftPct, widthPx, rotateDeg, url });
      }
      return results;
    };

    const scatters = generateScatters(LANDING_ASSET_URLS);
    return (
      <main className="relative min-h-screen w-screen">
        <div className="absolute inset-0">
          <GridBackground zoom={1} pan={{ x: 0, y: 0 }} />
          <div className="pointer-events-none absolute inset-0">
            {scatters.map((s, idx) => (
              <img
                key={`${s.url}-${idx}`}
                src={s.url}
                alt="example"
                loading="lazy"
                draggable={false}
                className="absolute rounded-md shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
                style={{
                  top: `${s.topPct}%`,
                  left: `${s.leftPct}%`,
                  width: `${s.widthPx}px`,
                  transform: `translate(-50%, -50%) rotate(${s.rotateDeg}deg)`,
                }}
              />
            ))}
          </div>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0)_0%,rgba(0,0,0,0.15)_55%,rgba(0,0,0,0.35)_100%)]" />
        </div>
        <div className="relative z-10 flex min-h-screen items-center justify-center px-6">
          <div className="max-w-2xl text-center">
            <h1 className="text-4xl md:text-6xl font-semibold tracking-tight">Moodboard</h1>
            <p className="mt-6 text-lg md:text-xl text-neutral-300">
              Generate images and videos with AI, then share the results with friends.
            </p>
            <div className="mt-10">
              <button
                onClick={() => signInWithGoogle()}
                disabled={loading}
                className="rounded-md bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-200 disabled:opacity-50"
              >
                Continue with Google
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }
  return (
    <main className="relative h-screen w-screen">
      <NoPageZoom />
      <ProjectsSidebar selectedProjectId={selectedProjectId} onSelect={(pid) => setSelectedProjectId(pid)} />
      <Canvas docId={selectedProjectId} />
      {showLoginBanner && (
        <div className="pointer-events-auto fixed inset-x-0 top-4 z-50 flex justify-center px-4">
          <LoginBanner onClose={() => setShowLoginBanner(false)} />
        </div>
      )}
      {notice && (
        <div className="pointer-events-auto fixed inset-x-0 top-4 z-50 mt-12 flex justify-center px-4">
          <div className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-neutral-100 ring-1 ring-white/10">
            {notice}
          </div>
        </div>
      )}
      {toastMessage && (
        <div className="pointer-events-auto fixed inset-x-0 top-4 z-50 mt-24 flex justify-center px-4">
          <div className="rounded-md bg-green-900 px-4 py-2 text-sm text-green-100 ring-1 ring-green-500/20">
            {toastMessage}
          </div>
        </div>
      )}
      <div className="fixed right-4 top-4 z-50">
        {user ? (
          <div className="flex items-center gap-2">
            {typeof balanceCents === "number" ? (
              <div className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 ring-1 ring-white/10">
                Balance: ${(balanceCents / 100).toFixed(2)}
              </div>
            ) : null}
            {selectedProjectId ? (
              shareInfo?.isPublic ? (
                <>
                  <button
                    onClick={copyShareLink}
                    disabled={shareBusy}
                    className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-neutral-200 disabled:opacity-50"
                  >
                    Copy link
                  </button>
                  <button
                    onClick={disableShare}
                    disabled={shareBusy}
                    className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-50"
                  >
                    Unshare
                  </button>
                </>
              ) : (
                <button
                  onClick={enableShare}
                  disabled={shareBusy}
                  className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-neutral-200 disabled:opacity-50"
                  aria-label="Share"
                  title="Share"
                >
                  <Share2 className="h-4 w-4" />
                </button>
              )
            ) : null}
            <div ref={profileRef} className="relative">
              <button
                onClick={() => setShowProfile((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={showProfile}
                aria-label="Account"
                className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
                title="Account"
              >
                <User className="h-4 w-4" />
              </button>
              {showProfile ? (
                <div className="absolute right-0 mt-2 w-44 rounded-md bg-neutral-900 p-2 text-sm text-neutral-100 ring-1 ring-white/10 shadow-lg">
                  <button
                    onClick={() => signOut()}
                    className="w-full rounded-sm bg-neutral-800 px-3 py-1.5 text-left hover:bg-neutral-700"
                  >
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <button
            onClick={() => signInWithGoogle()}
            disabled={loading}
            className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-neutral-200 disabled:opacity-50"
          >
            Continue with Google
          </button>
        )}
      </div>

      {approvalDialog.isOpen && (
        <div className="pointer-events-auto fixed inset-x-0 bottom-32 flex justify-center px-4 z-[60]">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 shadow-lg ring-1 ring-white/10">
            <div className="text-sm text-neutral-100 mb-3">
              You have {pendingCount} prompts running. Start {approvalDialog.toStart} more now?
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => handleApprovalResponse(false)}
                className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-700"
              >
                Cancel
              </button>
              <button
                onClick={() => handleApprovalResponse(true)}
                className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-neutral-200"
              >
                Run anyway
              </button>
            </div>
          </div>
        </div>
      )}
      {spendDialog.isOpen && (
        <div className="pointer-events-auto fixed inset-x-0 bottom-40 flex justify-center px-4 z-[65]">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 shadow-lg ring-1 ring-white/10">
            <div className="text-sm text-neutral-100 mb-3">
              This run is estimated to cost <span className="font-semibold">${(spendDialog.amountCents / 100).toFixed(2)}</span> for {spendDialog.batchCount} prompt{spendDialog.batchCount === 1 ? "" : "s"} × {spendDialog.imagesPerPrompt} image{spendDialog.imagesPerPrompt === 1 ? "" : "s"} each. Proceed?
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => handleSpendResponse(false)}
                className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-700"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSpendResponse(true)}
                className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-neutral-200"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 flex justify-center px-4 z-50">
        <div className="w-full max-w-[700px]">
          <PromptForm 
            onSubmit={handlePrompt} 
            pendingCount={pendingCount}
            onRequestOverLimitApproval={handleOverLimitApproval}
            spendConfirmThresholdCents={SPEND_CONFIRM_THRESHOLD_CENTS}
            onRequestHighSpendApproval={handleSpendApproval}
          />
        </div>
      </div>
    </main>
  );
}
