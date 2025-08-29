import type { SupabaseClient } from "@supabase/supabase-js";

function parseBooleanEnv(value: string | undefined): boolean | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return null;
}

function envKeyForModel(modelId: string): string {
  const norm = modelId.replace(/[^a-z0-9]+/gi, "_").toUpperCase();
  return `CREDITS_ENFORCE_${norm}`;
}

function getEnvOverride(modelId: string): boolean | null {
  const key = envKeyForModel(modelId);
  return parseBooleanEnv(process.env[key]);
}

type Policy = { enforce: boolean; costCents: number };

const CACHE_TTL_MS = 15_000;
const policyCache: Map<string, { value: Policy; expiresAt: number }> = new Map();

export async function getCreditPolicy(supabase: SupabaseClient, modelId: string): Promise<Policy> {
  const envOverride = getEnvOverride(modelId);
  if (envOverride === false) {
    // Explicitly disabled; skip any DB access entirely
    return { enforce: false, costCents: 0 };
  }

  // If override is explicitly true, we still need the cost from DB
  const now = Date.now();
  const cached = policyCache.get(modelId);
  if (cached && cached.expiresAt > now) {
    const base = cached.value;
    if (envOverride === true) return { enforce: true, costCents: base.costCents };
    return base;
  }

  const { data } = await supabase
    .from("model_costs")
    .select("cost_cents,enforce_check")
    .eq("model_id", modelId)
    .maybeSingle();

  const dbCost = Number.isFinite((data as any)?.cost_cents) ? Number((data as any).cost_cents) : 0;
  const dbEnforce = typeof (data as any)?.enforce_check === "boolean" ? Boolean((data as any).enforce_check) : true;

  const result: Policy = {
    enforce: envOverride === true ? true : dbEnforce,
    costCents: dbCost,
  };
  policyCache.set(modelId, { value: result, expiresAt: now + CACHE_TTL_MS });
  return result;
}


