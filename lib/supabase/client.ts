"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export function createClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Avoid throwing at import-time; surface a clear runtime message instead
    // eslint-disable-next-line no-console
    console.warn("Supabase env vars are missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}


