import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { createClient } from "@/lib/supabase/server";
import { getCreditPolicy } from "@/lib/billing/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DurationEnum = "5" | "10";

type KlingI2VInput = {
  prompt: string;
  image_url: string;
  duration?: DurationEnum; // default 5
  negative_prompt?: string; // default "blur, distort, and low quality"
  cfg_scale?: number; // default 0.5 (0..1)
};

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
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

  let body: KlingI2VInput;
  try {
    body = (await req.json()) as KlingI2VInput;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const prompt = (body?.prompt ?? "").toString().trim();
  if (!prompt) return badRequest("Field 'prompt' is required");
  if (prompt.length > 4000) return badRequest("Prompt too long (max 4000 chars)");

  const image_url = (body?.image_url ?? "").toString().trim();
  if (!image_url) return badRequest("Field 'image_url' is required");
  // Allow http(s) and data URIs; the backend will validate content
  if (!/^https?:\/\//i.test(image_url) && !/^data:/i.test(image_url)) {
    return badRequest("image_url must be http(s) or data URI");
  }

  const duration = (body?.duration ?? "5") as DurationEnum;
  if (!( ["5", "10"] as const ).includes(duration)) {
    return badRequest("duration must be '5' or '10'");
  }
  const negative_prompt = (body?.negative_prompt ?? "blur, distort, and low quality").toString();

  let cfg_scale = body?.cfg_scale;
  if (typeof cfg_scale !== "number" || Number.isNaN(cfg_scale)) cfg_scale = 0.5;
  if (cfg_scale < 0 || cfg_scale > 1) return badRequest("cfg_scale must be between 0 and 1");

  fal.config({ credentials: process.env.FAL_KEY });
  const input: KlingI2VInput = {
    prompt,
    image_url,
    duration,
    negative_prompt,
    cfg_scale,
  };

  // --- Credit policy ---
  const policy = await getCreditPolicy(supabase, "kling2.1-standard-i2v");
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
    const result = await fal.subscribe("fal-ai/kling-video/v2.1/standard/image-to-video", {
      input,
      logs: true,
    });
    const payload = (result as any)?.data ?? result;
    if (shouldEnforce) {
      const { error: deductErr } = await supabase.rpc("rpc_deduct_credits", {
        p_model_id: "kling2.1-standard-i2v",
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
      const result = await fal.subscribe("fal-ai/kling-video/v2.1/standard/image-to-video", {
        input,
        logs: true,
      });
      const payload = (result as any)?.data ?? result;
      if (shouldEnforce) {
        const { error: deductErr } = await supabase.rpc("rpc_deduct_credits", {
          p_model_id: "kling2.1-standard-i2v",
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
      const message = err2?.message || "Failed to generate video";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }
}



