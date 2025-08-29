import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("canvases")
    .select("id, owner_id, title, data, is_public, public_slug, updated_at, created_at")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data, { status: 200 });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const update: any = {};
  if (typeof body.title === "string" || body.title === null) update.title = body.title;
  if (body.data && typeof body.data === "object") update.data = body.data;
  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true }, { status: 200 });

  const { data, error } = await supabase
    .from("canvases")
    .update(update)
    .eq("id", id)
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data?.id }, { status: 200 });
}
