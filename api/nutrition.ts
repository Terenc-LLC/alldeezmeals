// TER-194: Server-side USDA FoodData Central proxy with shared nutrition cache.
// FDC_API_KEY is server-side only — never reaches the browser.
// Cache reads/writes use the caller's user JWT so auth.uid() resolves in RLS;
// no service-role key needed here (unlike /api/ingest-order).

import { createClient } from "@supabase/supabase-js";

const FDC_BASE = "https://api.nal.usda.gov/fdc/v1";
const OFF_BASE = "https://world.openfoodfacts.org/api/v0";
const CACHE_TTL_DAYS = 30;

export const USDA_ATTRIBUTION = "Nutrition data: USDA FoodData Central";
const OFF_ATTRIBUTION = "Nutrition data: Open Food Facts (ODbL)";

// Same logic as App.tsx:normalizeIngName — keep in sync (flagged in TER-202/195).
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Ingredients that yield no useful nutrition and should be skipped by callers.
const SKIP_TERMS = ["to taste", "as needed", "for garnish", "optional"];

type FoodPortion = { modifier: string; gramWeight: number };

type NutritionResult = {
  kcal_per_100g: number;
  serving_basis?: string;
  foodPortions?: FoodPortion[];
  macros?: { protein_g: number; fat_g: number; carbs_g: number };
  fdcId?: string | number;
  gtin?: string;
  dataType: string;
  source: "usda" | "off";
  attribution: string;
};

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

function extractNutrients(
  foodNutrients: any[],
): { kcal_per_100g: number; macros?: { protein_g: number; fat_g: number; carbs_g: number } } | null {
  // Detail endpoint: { nutrient: { id }, amount }
  // Search endpoint: { nutrientId, value }
  const find = (id: number): number | null => {
    const n = foodNutrients.find(
      (n: any) => (n.nutrient?.id ?? n.nutrientId) === id,
    );
    return n != null ? (n.amount ?? n.value ?? null) : null;
  };
  const kcal = find(1008); // Energy (kcal)
  if (kcal == null) return null;
  const protein = find(1003); // Protein
  const fat = find(1004);    // Total lipid (fat)
  const carbs = find(1005);  // Carbohydrate, by difference
  const macros =
    protein != null && fat != null && carbs != null
      ? { protein_g: protein, fat_g: fat, carbs_g: carbs }
      : undefined;
  return { kcal_per_100g: kcal, macros };
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

async function fetchFdcDetail(fdcId: number | string, apiKey: string): Promise<any | null> {
  const r = await fetch(`${FDC_BASE}/food/${fdcId}?api_key=${encodeURIComponent(apiKey)}`);
  if (!r.ok) return null;
  return r.json();
}

async function lookupByName(query: string, apiKey: string): Promise<NutritionResult | null> {
  const url =
    `${FDC_BASE}/foods/search?query=${encodeURIComponent(query)}` +
    `&dataType=Foundation,SR%20Legacy&pageSize=10&api_key=${encodeURIComponent(apiKey)}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const data = await r.json();
  const foods: any[] = data.foods ?? [];
  if (foods.length === 0) return null;

  const best = foods.reduce((a, b) => (scoreFood(a) >= scoreFood(b) ? a : b));

  const detail = await fetchFdcDetail(best.fdcId, apiKey);
  if (!detail) return null;

  const nutrients = extractNutrients(detail.foodNutrients ?? []);
  if (!nutrients) return null;

  const portions = extractPortions(detail);
  const servingBasis = portions.length > 0 ? `${portions[0].modifier} = ${portions[0].gramWeight}g` : undefined;

  return {
    kcal_per_100g: nutrients.kcal_per_100g,
    ...(servingBasis ? { serving_basis: servingBasis } : {}),
    ...(portions.length > 0 ? { foodPortions: portions } : {}),
    ...(nutrients.macros ? { macros: nutrients.macros } : {}),
    fdcId: detail.fdcId ?? best.fdcId,
    dataType: detail.dataType ?? best.dataType ?? "Foundation",
    source: "usda",
    attribution: USDA_ATTRIBUTION,
  };
}

async function lookupByGtin(gtin: string, apiKey: string): Promise<NutritionResult | null> {
  // FDC GTIN lookup: search Branded by GTIN, match on gtinUpc field.
  const fdcUrl =
    `${FDC_BASE}/foods/search?query=${encodeURIComponent(gtin)}` +
    `&dataType=Branded&pageSize=5&api_key=${encodeURIComponent(apiKey)}`;
  const fdcR = await fetch(fdcUrl);
  if (fdcR.ok) {
    const fdcData = await fdcR.json();
    const foods: any[] = fdcData.foods ?? [];
    const match = foods.find((f: any) => f.gtinUpc === gtin);
    if (match) {
      const detail = await fetchFdcDetail(match.fdcId, apiKey);
      if (detail) {
        const nutrients = extractNutrients(detail.foodNutrients ?? []);
        if (nutrients) {
          const servingSize = detail.servingSize;
          const servingUnit = detail.servingSizeUnit ?? "";
          const servingBasis =
            servingSize != null ? `${servingSize}${servingUnit}` : undefined;
          return {
            kcal_per_100g: nutrients.kcal_per_100g,
            ...(servingBasis ? { serving_basis: servingBasis } : {}),
            ...(nutrients.macros ? { macros: nutrients.macros } : {}),
            fdcId: detail.fdcId,
            gtin,
            dataType: "Branded",
            source: "usda",
            attribution: USDA_ATTRIBUTION,
          };
        }
      }
    }
  }

  // Open Food Facts fallback (keyless).
  const offR = await fetch(`${OFF_BASE}/product/${gtin}.json`);
  if (offR.ok) {
    const offData = await offR.json();
    if (offData.status === 1 && offData.product) {
      const p = offData.product;
      const kcal =
        p.nutriments?.["energy-kcal_100g"] ??
        p.nutriments?.["energy-kcal"] ??
        null;
      if (kcal != null && kcal > 0) {
        const protein = p.nutriments?.proteins_100g ?? null;
        const fat = p.nutriments?.fat_100g ?? null;
        const carbs = p.nutriments?.carbohydrates_100g ?? null;
        const macros =
          protein != null && fat != null && carbs != null
            ? { protein_g: protein, fat_g: fat, carbs_g: carbs }
            : undefined;
        return {
          kcal_per_100g: kcal,
          ...(macros ? { macros } : {}),
          gtin,
          dataType: "Branded",
          source: "off",
          attribution: OFF_ATTRIBUTION,
        };
      }
    }
  }

  return null;
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
    cacheKey = normalizeName(ingredient);
  } else {
    gtin = typeof body.gtin === "string" ? body.gtin.trim() : "";
    if (!gtin) {
      res.status(400).json({ error: "gtin required for gtin mode" });
      return;
    }
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
  let nutrition: NutritionResult | null = null;
  try {
    if (mode === "name") {
      nutrition = await lookupByName(ingredient, fdcKey);
    } else {
      nutrition = await lookupByGtin(gtin, fdcKey);
    }
  } catch (e: any) {
    console.error("nutrition lookup error:", cacheKey, e?.message);
  }

  const payload: CachedPayload = nutrition
    ? { hit: true, ...nutrition }
    : { hit: false, miss_reason: "no_match" };

  // Cache write is non-fatal — a failed write must never break the lookup.
  try {
    const now = new Date().toISOString();
    const row = {
      cache_key: cacheKey,
      result: payload,
      fdc_id: nutrition?.fdcId != null ? String(nutrition.fdcId) : null,
      gtin: nutrition?.gtin ?? (mode === "gtin" ? gtin : null),
      source: nutrition?.source ?? "miss",
      retrieved_at: now,
    };
    // upsert handles both fresh insert and stale-row update.
    const { error: upsertErr } = await userClient
      .from("nutrition_cache")
      .upsert(row, { onConflict: "cache_key" });
    if (upsertErr) {
      console.error("nutrition_cache upsert failed (non-fatal):", cacheKey, upsertErr.message);
    }
  } catch (e: any) {
    console.error("nutrition_cache write threw (non-fatal):", cacheKey, e?.message);
  }

  res.status(200).json(payload);
}
