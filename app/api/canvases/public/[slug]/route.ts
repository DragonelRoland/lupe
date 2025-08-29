import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("canvases")
    .select("id, title, data, is_public, public_slug, updated_at")
    .eq("public_slug", slug)
    .eq("is_public", true)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data, { status: 200 });
}
