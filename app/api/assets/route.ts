import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AssetOutput = {
  kind: "image" | "video";
  url: string;
  width?: number;
  height?: number;
  duration_seconds?: number;
};

type AssetLogRequest = {
  model_id: string;
  canvas_id?: string;
  prompt: string;
  negative_prompt?: string;
  params?: Record<string, any>;
  input_image_urls?: string[];
  request_id?: string;
  outputs: AssetOutput[];
};

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  // Require authentication
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "60")));
  const cursor = searchParams.get("cursor"); // ISO timestamp
  const kind = searchParams.get("kind"); // "image" or "video"
  const model_id = searchParams.get("model_id");
  const canvas_id = searchParams.get("canvas_id");

  try {
    let query = supabase
      .from("generated_assets")
      .select("id, kind, output_url, width, height, duration_seconds, model_id, canvas_id, prompt, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit + 1); // +1 to check if there are more items

    if (cursor) {
      query = query.lt("created_at", cursor);
    }
    if (kind && (kind === "image" || kind === "video")) {
      query = query.eq("kind", kind);
    }
    if (model_id) {
      query = query.eq("model_id", model_id);
    }
    if (canvas_id) {
      query = query.eq("canvas_id", canvas_id);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Failed to fetch assets:", error);
      return NextResponse.json({ error: "Failed to fetch assets" }, { status: 500 });
    }

    const items = data || [];
    const hasMore = items.length > limit;
    const resultItems = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore && resultItems.length > 0 ? resultItems[resultItems.length - 1].created_at : null;

    return NextResponse.json({
      items: resultItems,
      next_cursor: nextCursor,
    });
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
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

  let body: AssetLogRequest;
  try {
    body = (await req.json()) as AssetLogRequest;
  } catch {
    return badRequest("Invalid JSON body");
  }

  // Validate required fields
  const model_id = (body?.model_id ?? "").toString().trim();
  if (!model_id) return badRequest("Field 'model_id' is required");

  const prompt = (body?.prompt ?? "").toString().trim();
  if (!prompt) return badRequest("Field 'prompt' is required");
  if (prompt.length > 4000) return badRequest("Prompt too long (max 4000 chars)");

  const outputs = Array.isArray(body?.outputs) ? body.outputs : [];
  if (outputs.length === 0) return badRequest("Field 'outputs' must be a non-empty array");

  // Validate outputs
  for (const output of outputs) {
    if (!output || typeof output !== "object") {
      return badRequest("Each output must be an object");
    }
    
    const kind = output.kind;
    if (kind !== "image" && kind !== "video") {
      return badRequest("Each output 'kind' must be 'image' or 'video'");
    }

    const url = (output.url ?? "").toString().trim();
    if (!url) return badRequest("Each output must have a 'url'");
    if (!isValidHttpUrl(url)) {
      return badRequest("Each output 'url' must be a valid http(s) URL");
    }

    // Validate numeric fields if present
    if (output.width !== undefined && (!Number.isFinite(output.width) || output.width < 1)) {
      return badRequest("Output 'width' must be a positive number");
    }
    if (output.height !== undefined && (!Number.isFinite(output.height) || output.height < 1)) {
      return badRequest("Output 'height' must be a positive number");
    }
    if (output.duration_seconds !== undefined && (!Number.isFinite(output.duration_seconds) || output.duration_seconds < 0)) {
      return badRequest("Output 'duration_seconds' must be a non-negative number");
    }
  }

  // Validate optional fields
  const canvas_id = body?.canvas_id ? body.canvas_id.toString().trim() : null;
  const negative_prompt = body?.negative_prompt ? body.negative_prompt.toString().trim() : null;
  if (negative_prompt && negative_prompt.length > 4000) {
    return badRequest("Negative prompt too long (max 4000 chars)");
  }

  const request_id = body?.request_id ? body.request_id.toString().trim() : null;

  // Validate and filter input_image_urls to only http(s)
  let input_image_urls: string[] | null = null;
  if (Array.isArray(body?.input_image_urls)) {
    const filtered = body.input_image_urls
      .filter((url): url is string => typeof url === "string")
      .map(url => url.trim())
      .filter(url => isValidHttpUrl(url));
    if (filtered.length > 0) {
      input_image_urls = filtered;
    }
  }

  // Validate params if present
  let params: Record<string, any> | null = null;
  if (body?.params && typeof body.params === "object" && !Array.isArray(body.params)) {
    params = body.params;
  }

  // Insert one row per output
  const insertedIds: string[] = [];
  
  try {
    for (const output of outputs) {
      const { data, error } = await supabase
        .from("generated_assets")
        .insert({
          user_id: user.id,
          canvas_id,
          request_id,
          model_id,
          kind: output.kind,
          prompt,
          negative_prompt,
          params,
          input_image_urls,
          output_url: output.url,
          width: output.width || null,
          height: output.height || null,
          duration_seconds: output.duration_seconds || null,
        })
        .select("id")
        .single();

      if (error) {
        console.error("Failed to insert generated asset:", error);
        return NextResponse.json(
          { error: "Failed to log asset" },
          { status: 500 }
        );
      }

      if (data?.id) {
        insertedIds.push(data.id);
      }
    }

    return NextResponse.json({ inserted_ids: insertedIds }, { status: 200 });
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json(
      { error: "Database error" },
      { status: 500 }
    );
  }
}
