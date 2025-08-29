import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabase
    .from("canvases")
    .select("id, title, created_at, updated_at, is_public, public_slug")
    .eq("owner_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ canvases: data ?? [] }, { status: 200 });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const title = (body?.title ?? null) as string | null;
  const dataPayload = body?.data && typeof body.data === "object" ? body.data : { elements: [], viewState: { zoom: 1, pan: { x: 0, y: 0 } }, version: 1 };

  const { data, error } = await supabase
    .from("canvases")
    .insert([{ owner_id: user.id, title, data: dataPayload }])
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data?.id }, { status: 201 });
}


