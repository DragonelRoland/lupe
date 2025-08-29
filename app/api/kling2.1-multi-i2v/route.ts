import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { createClient } from "@/lib/supabase/server";
import { getCreditPolicy } from "@/lib/billing/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DurationEnum = "5" | "10";
type AspectRatioEnum = "16:9" | "9:16" | "1:1";

type KlingMultiI2VInput = {
  prompt: string;
  input_image_urls: string[]; // 2-4 images
  duration?: DurationEnum; // default 5
  aspect_ratio?: AspectRatioEnum; // default "16:9"
  negative_prompt?: string; // default "blur, distort, and low quality"
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

  let body: KlingMultiI2VInput;
  try {
    body = (await req.json()) as KlingMultiI2VInput;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const prompt = (body?.prompt ?? "").toString().trim();
  if (!prompt) return badRequest("Field 'prompt' is required");
  if (prompt.length > 4000) return badRequest("Prompt too long (max 4000 chars)");

  const rawUrls = Array.isArray(body?.input_image_urls) ? body.input_image_urls : [];
  if (rawUrls.length < 2 || rawUrls.length > 4) {
    return badRequest("input_image_urls must include 2 to 4 images");
  }
  const input_image_urls = rawUrls.map((u) => (u ?? "").toString().trim()).filter(Boolean);
  if (input_image_urls.length !== rawUrls.length) return badRequest("input_image_urls contains invalid entries");
  
  for (const u of input_image_urls) {
    // Allow both http(s) URLs and data URIs for flexibility
    if (!isHttpUrl(u) && !/^data:/i.test(u)) {
      return badRequest("All input_image_urls must be http(s) URLs or data URIs");
    }
  }

  const duration = (body?.duration ?? "5") as DurationEnum;
  if (!( ["5", "10"] as const ).includes(duration)) {
    return badRequest("duration must be '5' or '10'");
  }

  const aspect_ratio = body?.aspect_ratio;
  if (aspect_ratio && !(["16:9", "9:16", "1:1"] as const).includes(aspect_ratio)) {
    return badRequest("aspect_ratio must be one of '16:9' | '9:16' | '1:1'");
  }

  const negative_prompt = (body?.negative_prompt ?? "blur, distort, and low quality").toString();

  fal.config({ credentials: process.env.FAL_KEY });
  const input: KlingMultiI2VInput = {
    prompt,
    input_image_urls,
    duration,
    negative_prompt,
    ...(aspect_ratio ? { aspect_ratio } : {}),
  };
  // FAL's Pro endpoint types currently require `image_url` even when using `input_image_urls`.
  // Provide the first image as `image_url` for compatibility.
  const falInput = { ...input, image_url: input_image_urls[0]! } as any;

  // --- Credit policy ---
  const policy = await getCreditPolicy(supabase, "kling2.1-multi-i2v");
  const shouldEnforce = policy.enforce && policy.costCents > 0;
  const requestId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  if (shouldEnforce) {
    const { data: balRow } = await supabase
      .from("user_credits")
      .select("balance_cents")
      .eq("user_id", user.id)
      .maybeSingle();
    const balanceCents = Number.isFinite(balRow?.balance_cents) ? Number(balRow!.balance_cents) : 0;
    if (balanceCents < policy.costCents) {
      return NextResponse.json({ error: "Insufficient credits" }, { status: 402 });
    }
  }

  try {
    // Kling multi-image is handled by the Pro endpoint via `input_image_urls`
    const result = await fal.subscribe("fal-ai/kling-video/v2.1/pro/image-to-video", {
      input: falInput,
      logs: true,
    });
    const payload = (result as any)?.data ?? result;
    if (shouldEnforce) {
      const { error: deductErr } = await supabase.rpc("rpc_deduct_credits", {
        p_model_id: "kling2.1-multi-i2v",
        p_request_id: requestId,
        p_amount_cents: null,
      } as any);
      if (deductErr) {
        const msg = deductErr.message || "Failed to deduct credits";
        return NextResponse.json({ error: msg }, { status: 502 });
      }
    }
    return NextResponse.json(payload, { status: 200 });
  } catch (err1: any) {
    try {
      const result = await fal.subscribe("fal-ai/kling-video/v2.1/pro/image-to-video", {
        input: falInput,
        logs: true,
      });
      const payload = (result as any)?.data ?? result;
      if (shouldEnforce) {
        const { error: deductErr } = await supabase.rpc("rpc_deduct_credits", {
          p_model_id: "kling2.1-multi-i2v",
          p_request_id: requestId,
          p_amount_cents: null,
        } as any);
        if (deductErr) {
          const msg = deductErr.message || "Failed to deduct credits";
          return NextResponse.json({ error: msg }, { status: 502 });
        }
      }
      return NextResponse.json(payload, { status: 200 });
    } catch (err2: any) {
      const message = err2?.message || "Failed to generate video";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }
}
