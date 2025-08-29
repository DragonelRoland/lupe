import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { createClient } from "@/lib/supabase/server";
import { getCreditPolicy } from "@/lib/billing/credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DurationEnum = "8s";
type ResolutionEnum = "720p" | "1080p";

type VeoFastI2VInput = {
  prompt: string;
  image_url: string;
  duration?: DurationEnum; // default 8s
  generate_audio?: boolean; // default true
  resolution?: ResolutionEnum; // default 720p
};

type ErrorCode = "BAD_PROMPT" | "MODEL_FAILURE" | "INVALID_INPUT" | "UNAUTHORIZED" | "INSUFFICIENT_CREDITS" | "RATE_LIMIT" | "UNKNOWN";

type StructuredError = {
  code: ErrorCode;
  message: string;
  requestId?: string;
};

function badRequest(message: string, code: ErrorCode = "INVALID_INPUT", requestId?: string) {
  const error: StructuredError = { code, message, requestId };
  return NextResponse.json({ error }, { status: 400 });
}

function classifyError(errorMessage: string): ErrorCode {
  const msg = errorMessage.toLowerCase();
  
  // Check for safety/policy violations (bad prompt indicators)
  const badPromptKeywords = [
    "policy", "safety", "unsafe", "disallowed", "guardrail", 
    "moderation", "violates", "content policy", "inappropriate",
    "blocked", "filtered", "restricted", "prohibited"
  ];
  
  if (badPromptKeywords.some(keyword => msg.includes(keyword))) {
    return "BAD_PROMPT";
  }
  
  // Check for rate limiting
  if (msg.includes("rate limit") || msg.includes("too many requests")) {
    return "RATE_LIMIT";
  }
  
  // Check for auth issues
  if (msg.includes("unauthorized") || msg.includes("invalid key") || msg.includes("authentication")) {
    return "UNAUTHORIZED";
  }
  
  // Check for credit issues
  if (msg.includes("insufficient") || msg.includes("credit") || msg.includes("balance")) {
    return "INSUFFICIENT_CREDITS";
  }
  
  // Default to model failure for generation errors
  return "MODEL_FAILURE";
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

  const requestId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  let body: VeoFastI2VInput;
  try {
    body = (await req.json()) as VeoFastI2VInput;
  } catch {
    return badRequest("Invalid JSON body", "INVALID_INPUT", requestId);
  }

  const prompt = (body?.prompt ?? "").toString().trim();
  if (!prompt) return badRequest("Field 'prompt' is required", "INVALID_INPUT", requestId);
  if (prompt.length > 4000) return badRequest("Prompt too long (max 4000 chars)", "INVALID_INPUT", requestId);

  const image_url = (body?.image_url ?? "").toString().trim();
  if (!image_url) return badRequest("Field 'image_url' is required", "INVALID_INPUT", requestId);
  // Allow http(s) and data URIs; the backend will validate content
  if (!/^https?:\/\//i.test(image_url) && !/^data:/i.test(image_url)) {
    return badRequest("image_url must be http(s) or data URI", "INVALID_INPUT", requestId);
  }

  const duration: DurationEnum | undefined = body?.duration;
  if (duration && !( ["8s"] as const ).includes(duration)) {
    return badRequest("duration must be '8s'", "INVALID_INPUT", requestId);
  }

  const resolution: ResolutionEnum | undefined = body?.resolution;
  if (resolution && !( ["720p", "1080p"] as const ).includes(resolution)) {
    return badRequest("resolution must be one of '720p' | '1080p'", "INVALID_INPUT", requestId);
  }

  const generate_audio = body?.generate_audio ?? true;

  fal.config({ credentials: process.env.FAL_KEY });

  const input: VeoFastI2VInput = {
    prompt,
    image_url,
    ...(duration ? { duration } : {}),
    generate_audio,
    ...(resolution ? { resolution } : {}),
  };

  // --- Credit policy ---
  const policy = await getCreditPolicy(supabase, "veo-fast-i2v");
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

  try {
    const result = await fal.subscribe("fal-ai/veo3/fast/image-to-video", {
      input,
      logs: true,
    });
    const payload = (result as any)?.data ?? result;
    try {
      const v = (payload as any)?.video;
      console.log("[veo-fast-i2v] payload video:", v ? { urlPreview: typeof v.url === "string" ? v.url.slice(0, 80) : typeof v.url } : null);
    } catch {}
    if (shouldEnforce) {
      const { error: deductErr } = await supabase.rpc("rpc_deduct_credits", {
        p_model_id: "veo-fast-i2v",
        p_request_id: requestId,
        p_amount_cents: null,
      } as any);
      if (deductErr) {
        const msg = deductErr.message || "Failed to deduct credits";
        const error: StructuredError = { code: "INSUFFICIENT_CREDITS", message: msg, requestId };
        return NextResponse.json({ error }, { status: 402 });
      }
    }
    return NextResponse.json(payload, { status: 200 });
  } catch (err1: any) {
    try {
      const result = await fal.subscribe("fal-ai/veo3/fast/image-to-video", {
        input,
        logs: true,
      });
      const payload = (result as any)?.data ?? result;
      if (shouldEnforce) {
        const { error: deductErr } = await supabase.rpc("rpc_deduct_credits", {
          p_model_id: "veo-fast-i2v",
          p_request_id: requestId,
          p_amount_cents: null,
        } as any);
        if (deductErr) {
          const msg = deductErr.message || "Failed to deduct credits";
          const error: StructuredError = { code: "INSUFFICIENT_CREDITS", message: msg, requestId };
          return NextResponse.json({ error }, { status: 402 });
        }
      }
      return NextResponse.json(payload, { status: 200 });
    } catch (err2: any) {
      const message = err2?.message || "Failed to generate video";
      const code = classifyError(message);
      const error: StructuredError = { code, message, requestId };
      
      // Log for debugging
      console.error("[veo-fast-i2v] Generation failed:", { code, message, requestId });
      
      // Return appropriate status code based on error type
      const statusCode = code === "BAD_PROMPT" ? 400 : 
                        code === "UNAUTHORIZED" ? 401 :
                        code === "INSUFFICIENT_CREDITS" ? 402 :
                        code === "RATE_LIMIT" ? 429 : 502;
      
      return NextResponse.json({ error }, { status: statusCode });
    }
  }
}
