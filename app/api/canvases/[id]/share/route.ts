import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function randomSlug(len = 10): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const enable: boolean = !!body?.enable;

  if (enable) {
    // Generate a unique slug (retry a few times on conflict)
    let slug = randomSlug(10);
    for (let i = 0; i < 3; i++) {
      const { data, error } = await supabase
        .from("canvases")
        .update({ is_public: true, public_slug: slug, shared_at: new Date().toISOString() })
        .eq("id", id)
        .select("public_slug")
        .single();
      if (!error && data?.public_slug) return NextResponse.json({ slug: data.public_slug }, { status: 200 });
      // On unique violation, rotate slug
      slug = randomSlug(11);
    }
    return NextResponse.json({ error: "Failed to set public slug" }, { status: 500 });
  } else {
    const { error } = await supabase
      .from("canvases")
      .update({ is_public: false, public_slug: null, shared_at: null })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}


