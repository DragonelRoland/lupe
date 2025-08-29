import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Map projects to canvases (no separate projects table yet)
  const { data, error } = await supabase
    .from("canvases")
    .select("id, title, created_at, updated_at")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const projects = (data || []).map((c: any) => ({ id: c.id, name: c.title ?? "Untitled", canvas_id: c.id, created_at: c.created_at, updated_at: c.updated_at }));
  return NextResponse.json({ projects }, { status: 200 });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const name = typeof body?.name === "string" && body.name.trim() ? String(body.name).trim() : "Untitled";

  const defaultPayload = { elements: [], viewState: { zoom: 1, pan: { x: 0, y: 0 } }, version: 1 };
  const { data: canvasRow, error: canvasErr } = await supabase
    .from("canvases")
    .insert([{ owner_id: user.id, title: name, data: defaultPayload }])
    .select("id, title, created_at, updated_at")
    .single();
  if (canvasErr || !canvasRow?.id) {
    return NextResponse.json({ error: canvasErr?.message || "Failed to create canvas" }, { status: 500 });
  }

  const project = { id: canvasRow.id, name: canvasRow.title ?? name, canvas_id: canvasRow.id, created_at: canvasRow.created_at, updated_at: canvasRow.updated_at };
  return NextResponse.json({ project }, { status: 201 });
}


