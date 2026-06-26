// TER-194: Server-side USDA FoodData Central proxy with shared nutrition cache.
// FDC_API_KEY is server-side only — never reaches the browser.
// Cache reads/writes use the caller's user JWT so auth.uid() resolves in RLS;
// no service-role key needed here (unlike /api/ingest-order).

import { createClient } from "@supabase/supabase-js";
import { normalizeIngName, normalizeGtin, gtinDigits } from "../src/lib/normalize.js";
import { isApproved } from "./_approved.js";
import {
  FDC_BASE,
  USDA_ATTRIBUTION,
  extractNutrients,
  fetchFdcDetail,
  lookupByGtin,
  type FoodPortion,
  type NutritionResult,
  type LookupOutcome,
} from "./_nutritionLookup.js";

const CACHE_TTL_DAYS = 30;

// Ingredients that yield no useful nutrition and should be skipped by callers.
const SKIP_TERMS = ["to taste", "as needed", "for garnish", "optional"];

type HitResponse = { hit: true } & NutritionResult;
type MissResponse = { hit: false; miss_reason: string };
type CachedPayload = HitResponse | MissResponse;

// Scoring heuristic from TER-193 spike: Foundation > SR Legacy; prefer "raw", penalise cooked.
function scoreFood(food: { dataType?: string; description?: string }): number {
  let score = 0;
  const dt = food.dataType ?? "";
  const desc = (food.description ?? "").toLowerCase();
  if (dt === "Foundation") score += 30;
  else if (dt === "SR Legacy") score += 20;
  else if (dt === "Branded") score += 10;
  if (desc.includes("raw")) score += 20;
  for (const bad of ["cooked", "baked", "broiled", "fried", "canned", "dried", "frozen"]) {
    if (desc.includes(bad)) {
      score -= 15;
      break;
    }
  }
  return score;
}

function extractPortions(detail: any): FoodPortion[] {
  const raw: any[] = detail.foodPortions ?? [];
  return raw
    .map((p: any) => ({
      modifier: (p.modifier ?? p.portionDescription ?? "").trim(),
      gramWeight: p.gramWeight ?? p.amount ?? 0,
    }))
    .filter((p) => p.modifier && p.gramWeight > 0);
}

async function lookupByName(query: string, apiKey: string): Promise<LookupOutcome> {
  const url =
    `${FDC_BASE}/foods/search?query=${encodeURIComponent(query)}` +
    `&dataType=Foundation,SR%20Legacy&pageSize=10&api_key=${encodeURIComponent(apiKey)}`;

  let r: Response;
  try {
    r = await fetch(url);
  } catch (e: any) {
    console.error("FDC search network error:", query, e?.message);
    return { status: "error" };
  }
  if (!r.ok) {
    console.error("FDC search non-2xx:", query, r.status);
    return { status: "error" };
  }

  const data = await r.json();
  const foods: any[] = data.foods ?? [];
  if (foods.length === 0) return { status: "miss" };

  const best = foods.reduce((a, b) => (scoreFood(a) >= scoreFood(b) ? a : b));

  let detail: any;
  try {
    detail = await fetchFdcDetail(best.fdcId, apiKey);
  } catch (e: any) {
    console.error("FDC detail network error:", best.fdcId, e?.message);
    return { status: "error" };
  }
  if (!detail) {
    console.error("FDC detail non-2xx:", best.fdcId);
    return { status: "error" };
  }

  const nutrients = extractNutrients(detail.foodNutrients ?? []);
  // Food found but no usable energy data — treat as a definitive miss, not a transient error.
  if (!nutrients) return { status: "miss" };

  const portions = extractPortions(detail);
  const servingBasis =
    portions.length > 0 ? `${portions[0].modifier} = ${portions[0].gramWeight}g` : undefined;

  return {
    status: "hit",
    data: {
      kcal_per_100g: nutrients.kcal_per_100g,
      ...(servingBasis ? { serving_basis: servingBasis } : {}),
      ...(portions.length > 0 ? { foodPortions: portions } : {}),
      ...(nutrients.macros ? { macros: nutrients.macros } : {}),
      fdcId: detail.fdcId ?? best.fdcId,
      dataType: detail.dataType ?? best.dataType ?? "Foundation",
      source: "usda",
      attribution: USDA_ATTRIBUTION,
    },
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const fdcKey = process.env.FDC_API_KEY;
  if (!fdcKey) {
    res.status(500).json({ error: "Server missing FDC_API_KEY" });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({ error: "Server missing Supabase configuration" });
    return;
  }

  // Validate Supabase JWT — same pattern as /api/generate.
  const authHeader = (req.headers["authorization"] as string) ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const anonClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: userData, error: authError } = await anonClient.auth.getUser(token);
  if (authError || !userData.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const approved = await isApproved(token, userData.user.id);
  if (!approved) { res.status(403).json({ error: "Account pending approval" }); return; }

  let body: { mode?: string; ingredient?: string; gtin?: string };
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const mode = body.mode;
  if (mode !== "name" && mode !== "gtin") {
    res.status(400).json({ error: "mode must be 'name' or 'gtin'" });
    return;
  }

  // Derive cache key: normalized ingredient name, or upc:{gtin}.
  let cacheKey: string;
  let ingredient = "";
  let gtin = "";
  let offBarcode = "";

  if (mode === "name") {
    ingredient = typeof body.ingredient === "string" ? body.ingredient.trim() : "";
    if (!ingredient) {
      res.status(400).json({ error: "ingredient required for name mode" });
      return;
    }
    // Skip "to taste" / "as needed" — callers fall through to catalog/estimate tiers.
    if (SKIP_TERMS.some((t) => ingredient.toLowerCase().includes(t))) {
      return res.status(200).json({ hit: false, miss_reason: "skip" } as MissResponse);
    }
    cacheKey = normalizeIngName(ingredient);
  } else {
    const rawGtin = typeof body.gtin === "string" ? body.gtin.trim() : "";
    if (!rawGtin) {
      res.status(400).json({ error: "gtin required for gtin mode" });
      return;
    }
    gtin = normalizeGtin(rawGtin);      // 14-digit canonical: cache key, FDC compare, stored gtin
    offBarcode = gtinDigits(rawGtin);   // digits-only, no padding: OFF fetch URL
    cacheKey = `upc:${gtin}`;
  }

  // Cache client uses the caller's access token so auth.uid() resolves for RLS write policies.
  // No service-role key needed — nutrition_cache RLS allows INSERT/UPDATE for any auth'd user.
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // Check cache.
  const { data: cached } = await userClient
    .from("nutrition_cache")
    .select("result, retrieved_at")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (cached) {
    const ageMs = Date.now() - new Date(cached.retrieved_at as string).getTime();
    const ttlMs = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
    if (ageMs < ttlMs) {
      return res.status(200).json(cached.result as CachedPayload);
    }
    // Stale — fall through to re-fetch and update.
  }

  // FDC / OFF lookup.
  let outcome: LookupOutcome;
  try {
    outcome = mode === "name"
      ? await lookupByName(ingredient, fdcKey)
      : await lookupByGtin(offBarcode, gtin, fdcKey);
  } catch (e: any) {
    // Defensive: lookups handle their own errors, but guard against unexpected throws.
    console.error("nutrition lookup threw:", cacheKey, e?.message);
    outcome = { status: "error" };
  }

  const payload: CachedPayload =
    outcome.status === "hit"
      ? { hit: true, ...outcome.data }
      : outcome.status === "miss"
      ? { hit: false, miss_reason: "no_match" }
      : { hit: false, miss_reason: "upstream_error" };

  // Gate: upsert only for "hit" or "miss" — never cache "upstream_error".
  // An error must not poison the cache and suppress retries for 30 days.
  if (outcome.status !== "error") {
    try {
      const now = new Date().toISOString();
      const hitData = outcome.status === "hit" ? outcome.data : null;
      const row = {
        cache_key: cacheKey,
        result: payload,
        fdc_id: hitData?.fdcId != null ? String(hitData.fdcId) : null,
        gtin: hitData?.gtin ?? (mode === "gtin" ? gtin : null),
        source: hitData?.source ?? "miss",
        retrieved_at: now,
      };
      const { error: upsertErr } = await userClient
        .from("nutrition_cache")
        .upsert(row, { onConflict: "cache_key" });
      if (upsertErr) {
        console.error("nutrition_cache upsert failed (non-fatal):", cacheKey, upsertErr.message);
      }
    } catch (e: any) {
      console.error("nutrition_cache write threw (non-fatal):", cacheKey, e?.message);
    }
  }

  res.status(200).json(payload);
}
