import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Ensure a balance row exists lazily (treat missing as default 100 in response only)
  const { data } = await supabase
    .from("user_credits")
    .select("balance_cents")
    .eq("user_id", user.id)
    .maybeSingle();

  const balance_cents = Number.isFinite(data?.balance_cents) ? Number(data!.balance_cents) : 100;
  return NextResponse.json({ balance_cents }, { status: 200 });
}
