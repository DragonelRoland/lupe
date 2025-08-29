import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate required fields
    if (!body || typeof body !== "object") {
      return badRequest("Invalid request body");
    }

    const { email, name, company, utm, referer, honeypot } = body;

    // Honeypot check - silently drop bot submissions
    if (honeypot && typeof honeypot === "string" && honeypot.trim()) {
      return NextResponse.json({ success: true }, { status: 200 });
    }

    // Validate email
    if (!email || typeof email !== "string") {
      return badRequest("Email is required");
    }

    const normalizedEmail = email.toString().trim().toLowerCase();
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      return badRequest("Invalid email address");
    }

    // Validate optional fields
    const normalizedName = name && typeof name === "string" ? name.toString().trim() : null;
    const normalizedCompany = company && typeof company === "string" ? company.toString().trim() : null;
    const normalizedReferer = referer && typeof referer === "string" ? referer.toString().trim() : null;

    // Validate UTM object
    let utmData = null;
    if (utm && typeof utm === "object" && !Array.isArray(utm)) {
      const cleanUtm: Record<string, string> = {};
      for (const [key, value] of Object.entries(utm)) {
        if (value && typeof value === "string" && value.trim()) {
          cleanUtm[key] = value.toString().trim();
        }
      }
      if (Object.keys(cleanUtm).length > 0) {
        utmData = cleanUtm;
      }
    }

    // Insert into Supabase
    const supabase = await createClient();
    
    const { error } = await supabase
      .from("waitlist_leads")
      .upsert(
        {
          email: normalizedEmail,
          name: normalizedName,
          company: normalizedCompany,
          source: "biotech_lp",
          utm: utmData,
          referer: normalizedReferer,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "email",
          ignoreDuplicates: false,
        }
      );

    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json(
        { error: "Failed to save to waitlist" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("Waitlist API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
