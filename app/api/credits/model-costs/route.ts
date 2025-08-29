import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  
  try {
    const { data, error } = await supabase
      .from("model_costs")
      .select("model_id, cost_cents");
    
    if (error) {
      console.error("Error fetching model costs:", error);
      return NextResponse.json({ error: "Failed to fetch model costs" }, { status: 500 });
    }
    
    // Convert array to object map for easy lookup
    const costs: Record<string, number> = {};
    if (data) {
      for (const row of data) {
        if (row.model_id && typeof row.cost_cents === "number") {
          costs[row.model_id] = row.cost_cents;
        }
      }
    }
    
    return NextResponse.json({ costs }, { status: 200 });
  } catch (error) {
    console.error("Error in model-costs API:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
