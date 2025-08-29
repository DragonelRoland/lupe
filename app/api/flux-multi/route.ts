import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { createClient } from "@/lib/supabase/server";
import { getCreditPolicy } from "@/lib/billing/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AspectRatioEnum =
  | "21:9"
  | "16:9"
  | "4:3"
  | "3:2"
  | "1:1"
  | "2:3"
  | "3:4"
  | "9:16"
  | "9:21";

type OutputFormatEnum = "jpeg" | "png";

type SafetyToleranceEnum = "1" | "2" | "3" | "4" | "5" | "6";

type FluxMultiInput = {
  prompt: string;
  image_urls: string[]; // required; 2-4 recommended
  seed?: number;
  guidance_scale?: number; // 1-20, default 3.5
  sync_mode?: boolean; // default false
  num_images?: number; // 1-4, default 1
  output_format?: OutputFormatEnum; // default jpeg
  safety_tolerance?: SafetyToleranceEnum; // default "2"
  enhance_prompt?: boolean; // default false
  aspect_ratio?: AspectRatioEnum; // optional
};

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  // Require authentication (gate this route)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.FAL_KEY) {
    return NextResponse.json(
      { error: "Server missing FAL_KEY. Set it in environment and restart." },
      { status: 500 }
    );
  }

  let body: FluxMultiInput;
  try {
    body = (await req.json()) as FluxMultiInput;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const prompt = (body?.prompt ?? "").toString().trim();
  if (!prompt) return badRequest("Field 'prompt' is required");
  if (prompt.length > 4000) return badRequest("Prompt too long (max 4000 chars)");

  const rawUrls = Array.isArray(body?.image_urls) ? body.image_urls : [];
  if (rawUrls.length < 2 || rawUrls.length > 4) {
    return badRequest("image_urls must include 2 to 4 http(s) URLs");
  }
  const image_urls = rawUrls.map((u) => (u ?? "").toString().trim()).filter(Boolean);
  if (image_urls.length !== rawUrls.length) return badRequest("image_urls contains invalid entries");
  for (const u of image_urls) {
    if (!isHttpUrl(u)) {
      return badRequest("All image_urls must be absolute http(s) URLs (no blob: or data:)");
    }
  }

  let guidance_scale = body?.guidance_scale ?? 3.5;
  if (!Number.isFinite(guidance_scale)) return badRequest("guidance_scale must be a number");
  guidance_scale = Math.max(1, Math.min(20, Number(guidance_scale)));

  let num_images = body?.num_images ?? 1;
  if (!Number.isFinite(num_images)) return badRequest("num_images must be a number");
  num_images = Math.max(1, Math.min(4, Math.floor(num_images)));

  const output_format: OutputFormatEnum = (body?.output_format ?? "jpeg");
  if (output_format !== "jpeg" && output_format !== "png") return badRequest("output_format must be 'jpeg' or 'png'");

  const safety_tolerance: SafetyToleranceEnum = (body?.safety_tolerance ?? "2") as SafetyToleranceEnum;
  if (!(["1", "2", "3", "4", "5", "6"] as const).includes(safety_tolerance)) {
    return badRequest("safety_tolerance must be one of '1' | '2' | '3' | '4' | '5' | '6'");
  }

  const enhance_prompt = body?.enhance_prompt ?? false;
  const sync_mode = body?.sync_mode ?? false;

  const aspect_ratio = body?.aspect_ratio;
  if (
    aspect_ratio &&
    !(["21:9", "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16", "9:21"] as const).includes(aspect_ratio)
  ) {
    return badRequest("aspect_ratio must be one of the documented enum values");
  }

  const seed = typeof body?.seed === "number" ? Math.floor(body.seed) : undefined;

  fal.config({ credentials: process.env.FAL_KEY });

  const input: FluxMultiInput = {
    prompt,
    image_urls,
    guidance_scale,
    num_images,
    output_format,
    safety_tolerance,
    enhance_prompt,
    sync_mode,
    ...(aspect_ratio ? { aspect_ratio } : {}),
    ...(seed !== undefined ? { seed } : {}),
  };

  // --- Credit policy ---
  const policy = await getCreditPolicy(supabase, "flux-multi");
  let shouldEnforce = policy.enforce && policy.costCents > 0;
  let costCents = policy.costCents;
  if (shouldEnforce) {
    const { data: balRow } = await supabase
      .from("user_credits")
      .select("balance_cents")
      .eq("user_id", user.id)
      .maybeSingle();
    const balanceCents = Number.isFinite(balRow?.balance_cents) ? Number(balRow!.balance_cents) : 100;
    if (balanceCents < costCents) {
      return NextResponse.json({ error: "Insufficient credits" }, { status: 402 });
    }
  }

  const requestId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  try {
    const result = await fal.subscribe("fal-ai/flux-pro/kontext/max/multi", {
      input,
      logs: true,
    });
    const payload = (result as any)?.data ?? result;
    try {
      const first = (payload as any)?.images?.[0];
      console.log("[flux-multi] payload first image:", first ? {
        urlPreview: typeof first.url === "string" ? first.url.slice(0, 60) : typeof first.url,
        content_type: first?.content_type,
        width: first?.width,
        height: first?.height,
      } : null);
    } catch {}
    if (shouldEnforce) {
      const { error: deductErr } = await supabase.rpc("rpc_deduct_credits", {
        p_model_id: "flux-multi",
        p_request_id: requestId,
        p_amount_cents: null,
      } as any);
      if (deductErr) {
        const msg = deductErr.message || "Failed to deduct credits";
        return NextResponse.json({ error: msg }, { status: 402 });
      }
    }
    return NextResponse.json(payload, { status: 200 });
  } catch (err1: any) {
    try {
      const result = await fal.subscribe("fal-ai/flux-pro/kontext/max/multi", {
        input,
        logs: true,
      });
      const payload = (result as any)?.data ?? result;
      if (shouldEnforce) {
        const { error: deductErr } = await supabase.rpc("rpc_deduct_credits", {
          p_model_id: "flux-multi",
          p_request_id: requestId,
          p_amount_cents: null,
        } as any);
        if (deductErr) {
          const msg = deductErr.message || "Failed to deduct credits";
          return NextResponse.json({ error: msg }, { status: 402 });
        }
      }
      return NextResponse.json(payload, { status: 200 });
    } catch (err2: any) {
      const message = err2?.message || "Failed to generate image";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }
}
