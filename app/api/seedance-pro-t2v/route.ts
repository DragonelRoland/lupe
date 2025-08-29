import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { createClient } from "@/lib/supabase/server";
import { getCreditPolicy } from "@/lib/billing/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AspectRatioEnum = "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
type ResolutionEnum = "480p" | "720p" | "1080p";
type DurationEnum = "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12";

type SeedanceProT2VInput = {
  prompt: string;
  aspect_ratio?: AspectRatioEnum; // default 16:9
  resolution?: ResolutionEnum; // default 1080p
  duration?: DurationEnum; // default 5 (seconds)
  camera_fixed?: boolean; // default false
  seed?: number; // use -1 for random
  enable_safety_checker?: boolean; // default true
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

  let body: SeedanceProT2VInput;
  try {
    body = (await req.json()) as SeedanceProT2VInput;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const prompt = (body?.prompt ?? "").toString().trim();
  if (!prompt) return badRequest("Field 'prompt' is required");
  if (prompt.length > 4000) return badRequest("Prompt too long (max 4000 chars)");

  const aspect_ratio: AspectRatioEnum | undefined = body?.aspect_ratio;
  if (
    aspect_ratio &&
    !( ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const ).includes(aspect_ratio)
  ) {
    return badRequest("aspect_ratio must be one of '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16'");
  }

  const resolution: ResolutionEnum | undefined = body?.resolution;
  if (resolution && !( ["480p", "720p", "1080p"] as const ).includes(resolution)) {
    return badRequest("resolution must be one of '480p' | '720p' | '1080p'");
  }

  let duration: DurationEnum | undefined = body?.duration as DurationEnum | undefined;
  if (duration && !( ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] as const ).includes(duration)) {
    return badRequest("duration must be one of '3'..'12' (seconds)");
  }

  const camera_fixed = body?.camera_fixed ?? false;
  const enable_safety_checker = body?.enable_safety_checker ?? true;

  const seed = typeof body?.seed === "number" ? Math.floor(body.seed) : undefined;

  fal.config({ credentials: process.env.FAL_KEY });

  const input: SeedanceProT2VInput = {
    prompt,
    ...(aspect_ratio ? { aspect_ratio } : {}),
    ...(resolution ? { resolution } : {}),
    ...(duration ? { duration } : {}),
    camera_fixed,
    enable_safety_checker,
    ...(seed !== undefined ? { seed } : {}),
  };

  // --- Credit policy ---
  const policy = await getCreditPolicy(supabase, "seedance-pro-t2v");
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
    const result = await fal.subscribe("fal-ai/bytedance/seedance/v1/pro/text-to-video", {
      input,
      logs: true,
    });
    const payload = (result as any)?.data ?? result;
    try {
      const v = (payload as any)?.video;
      console.log("[seedance-pro-t2v] payload video:", v ? { urlPreview: typeof v.url === "string" ? v.url.slice(0, 80) : typeof v.url } : null);
    } catch {}
    if (shouldEnforce) {
      const { error: deductErr } = await supabase.rpc("rpc_deduct_credits", {
        p_model_id: "seedance-pro-t2v",
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
      const result = await fal.subscribe("fal-ai/bytedance/seedance/v1/pro/text-to-video", {
        input,
        logs: true,
      });
      const payload = (result as any)?.data ?? result;
      if (shouldEnforce) {
        const { error: deductErr } = await supabase.rpc("rpc_deduct_credits", {
          p_model_id: "seedance-pro-t2v",
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


