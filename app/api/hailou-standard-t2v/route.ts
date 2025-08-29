import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { createClient } from "@/lib/supabase/server";
import { getCreditPolicy } from "@/lib/billing/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DurationEnum = "6" | "10";

type HailouStandardT2VInput = {
  prompt: string;
  duration?: DurationEnum; // default 6
  prompt_optimizer?: boolean; // default true
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

  let body: HailouStandardT2VInput;
  try {
    body = (await req.json()) as HailouStandardT2VInput;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const prompt = (body?.prompt ?? "").toString().trim();
  if (!prompt) return badRequest("Field 'prompt' is required");
  if (prompt.length > 4000) return badRequest("Prompt too long (max 4000 chars)");

  const duration = (body?.duration ?? "6") as DurationEnum;
  if (!(["6", "10"] as const).includes(duration)) {
    return badRequest("duration must be '6' or '10'");
  }
  const prompt_optimizer = body?.prompt_optimizer ?? true;

  fal.config({ credentials: process.env.FAL_KEY });
  const input: HailouStandardT2VInput = {
    prompt,
    duration,
    prompt_optimizer,
  };

  // --- Credit policy ---
  const policy = await getCreditPolicy(supabase, "hailou-standard-t2v");
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
    const result = await fal.subscribe("fal-ai/minimax/hailuo-02/standard/text-to-video", {
      input,
      logs: true,
    });
    const payload = (result as any)?.data ?? result;
    if (shouldEnforce) {
      const { error: deductErr } = await supabase.rpc("rpc_deduct_credits", {
        p_model_id: "hailou-standard-t2v",
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
      const result = await fal.subscribe("fal-ai/minimax/hailuo-02/standard/text-to-video", {
        input,
        logs: true,
      });
      const payload = (result as any)?.data ?? result;
      if (shouldEnforce) {
        const { error: deductErr } = await supabase.rpc("rpc_deduct_credits", {
          p_model_id: "hailou-standard-t2v",
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


