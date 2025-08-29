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

type FluxProUltraInput = {
  prompt: string;
  seed?: number;
  sync_mode?: boolean; // default false
  num_images?: number; // 1-4, default 1
  enable_safety_checker?: boolean; // default true
  output_format?: OutputFormatEnum; // default jpeg
  safety_tolerance?: SafetyToleranceEnum; // default "2"
  enhance_prompt?: boolean; // default false
  aspect_ratio?: AspectRatioEnum; // optional
  raw?: boolean; // default false
};

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(req: Request) {
  // Require authentication
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

  let body: FluxProUltraInput;
  try {
    body = (await req.json()) as FluxProUltraInput;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const prompt = (body?.prompt ?? "").toString().trim();
  if (!prompt) return badRequest("Field 'prompt' is required");
  if (prompt.length > 4000) return badRequest("Prompt too long (max 4000 chars)");

  let num_images = body?.num_images ?? 1;
  if (!Number.isFinite(num_images)) return badRequest("num_images must be a number");
  num_images = Math.max(1, Math.min(4, Math.floor(num_images)));

  const enable_safety_checker = body?.enable_safety_checker ?? true;
  
  const output_format: OutputFormatEnum = body?.output_format ?? "jpeg";
  if (output_format !== "jpeg" && output_format !== "png") {
    return badRequest("output_format must be 'jpeg' or 'png'");
  }

  const safety_tolerance: SafetyToleranceEnum = (body?.safety_tolerance ?? "2") as SafetyToleranceEnum;
  if (!("123456".includes(safety_tolerance))) {
    return badRequest("safety_tolerance must be one of '1' | '2' | '3' | '4' | '5' | '6'");
  }

  const enhance_prompt = body?.enhance_prompt ?? false;
  const raw = body?.raw ?? false;
  const sync_mode = body?.sync_mode ?? false;

  const aspect_ratio = body?.aspect_ratio;
  if (
    aspect_ratio &&
    !(
      [
        "21:9",
        "16:9",
        "4:3",
        "3:2",
        "1:1",
        "2:3",
        "3:4",
        "9:16",
        "9:21",
      ] as const
    ).includes(aspect_ratio)
  ) {
    return badRequest("aspect_ratio must be one of the documented enum values");
  }

  const seed = typeof body?.seed === "number" ? Math.floor(body.seed) : undefined;

  fal.config({ credentials: process.env.FAL_KEY });

  const input: FluxProUltraInput = {
    prompt,
    num_images,
    enable_safety_checker,
    output_format,
    safety_tolerance,
    enhance_prompt,
    raw,
    sync_mode,
    ...(aspect_ratio ? { aspect_ratio } : {}),
    ...(seed !== undefined ? { seed } : {}),
  };

  // --- Credit policy ---
  const policy = await getCreditPolicy(supabase, "flux-pro-ultra");
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

  const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  // Single retry on transient failure
  try {
    const result = await fal.subscribe("fal-ai/flux-pro/v1.1-ultra", {
      input,
      logs: true,
    });
    const payload = (result as any)?.data ?? result;
    if (shouldEnforce) {
      const { error: deductErr } = await supabase.rpc("rpc_deduct_credits", {
        p_model_id: "flux-pro-ultra",
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
      const result = await fal.subscribe("fal-ai/flux-pro/v1.1-ultra", {
        input,
        logs: true,
      });
      const payload = (result as any)?.data ?? result;
      if (shouldEnforce) {
        const { error: deductErr } = await supabase.rpc("rpc_deduct_credits", {
          p_model_id: "flux-pro-ultra",
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
