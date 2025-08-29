import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImageSizeEnum =
  | "square_hd"
  | "square"
  | "portrait_4_3"
  | "portrait_16_9"
  | "landscape_4_3"
  | "landscape_16_9";

type ImageSizeObject = {
  width: number;
  height: number;
};

type FluxSchnellInput = {
  prompt: string;
  num_inference_steps?: number; // 1-12, default 4
  image_size?: ImageSizeEnum | ImageSizeObject; // default landscape_4_3
  seed?: number | null;
  guidance_scale?: number; // 1-20, default 3.5
  sync_mode?: boolean; // default false
  num_images?: number; // 1-4, default 1
  enable_safety_checker?: boolean; // default true
  output_format?: "jpeg" | "png"; // default jpeg
  acceleration?: "none" | "regular" | "high"; // default none
};

function isValidImageSizeObject(value: unknown): value is ImageSizeObject {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as any).width == null ||
    (value as any).height == null
  ) {
    return false;
  }
  const { width, height } = value as any;
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    width <= 14142 &&
    height <= 14142
  );
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(req: Request) {
  if (!process.env.FAL_KEY) {
    return NextResponse.json(
      { error: "Server missing FAL_KEY. Set it in environment and restart." },
      { status: 500 }
    );
  }

  let body: FluxSchnellInput;
  try {
    body = (await req.json()) as FluxSchnellInput;
  } catch {
    return badRequest("Invalid JSON body");
  }

  const prompt = (body?.prompt ?? "").toString().trim();
  if (!prompt) return badRequest("Field 'prompt' is required");
  if (prompt.length > 4000) return badRequest("Prompt too long (max 4000 chars)");

  let num_inference_steps = body?.num_inference_steps ?? 4;
  if (!Number.isFinite(num_inference_steps)) return badRequest("num_inference_steps must be a number");
  num_inference_steps = Math.max(1, Math.min(12, Math.floor(num_inference_steps)));

  let guidance_scale = body?.guidance_scale ?? 3.5;
  if (!Number.isFinite(guidance_scale)) return badRequest("guidance_scale must be a number");
  guidance_scale = Math.max(1, Math.min(20, Number(guidance_scale)));

  let num_images = body?.num_images ?? 1;
  if (!Number.isFinite(num_images)) return badRequest("num_images must be a number");
  num_images = Math.max(1, Math.min(4, Math.floor(num_images)));

  const enable_safety_checker = body?.enable_safety_checker ?? true;
  const output_format = body?.output_format ?? "jpeg";
  if (output_format !== "jpeg" && output_format !== "png") return badRequest("output_format must be 'jpeg' or 'png'");

  const acceleration = body?.acceleration ?? "none";
  if (!["none", "regular", "high"].includes(acceleration)) return badRequest("acceleration must be 'none' | 'regular' | 'high'");

  const sync_mode = body?.sync_mode ?? true; // prefer direct response behavior

  let image_size: FluxSchnellInput["image_size"] = body?.image_size ?? "landscape_4_3";
  if (typeof image_size === "string") {
    if (![
      "square_hd",
      "square",
      "portrait_4_3",
      "portrait_16_9",
      "landscape_4_3",
      "landscape_16_9",
    ].includes(image_size)) {
      return badRequest(
        "image_size must be one of enum values or an object { width, height }"
      );
    }
  } else if (!isValidImageSizeObject(image_size)) {
    return badRequest("image_size object must include valid width and height (<=14142)");
  }

  const seed = body?.seed ?? null;

  fal.config({ credentials: process.env.FAL_KEY });

  const input: FluxSchnellInput = {
    prompt,
    num_inference_steps,
    image_size,
    seed,
    guidance_scale,
    sync_mode,
    num_images,
    enable_safety_checker,
    output_format,
    acceleration,
  };

  // Single retry on transient failure
  try {
    const result = await fal.run("fal-ai/flux/schnell", { input });
    const payload = (result as any)?.data ?? result;
    return NextResponse.json(payload, { status: 200 });
  } catch (err: any) {
    try {
      const result = await fal.run("fal-ai/flux/schnell", { input });
      const payload = (result as any)?.data ?? result;
      return NextResponse.json(payload, { status: 200 });
    } catch (err2: any) {
      const message = err2?.message || "Failed to generate image";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }
}
