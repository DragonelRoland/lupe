import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(req: Request, { params }: any) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const name = typeof body?.name === "string" ? String(body.name).trim() : null;
  if (!name) return NextResponse.json({ error: "Invalid name" }, { status: 400 });

  const { data, error } = await supabase
    .from("canvases")
    .update({ title: name })
    .eq("id", params.id)
    .eq("owner_id", user.id)
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data?.id }, { status: 200 });
}


