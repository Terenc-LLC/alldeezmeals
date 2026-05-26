// TER-196: Client-side nutrition resolution engine.
// Resolves kcal/serving for a generated meal by querying /api/nutrition (USDA)
// and the ALDI catalog (Supabase), then converting ingredient amounts to grams.

import { normalizeIngName } from "./normalize.js";
import { supabase } from "../supabase.js";

export const USDA_ATTRIBUTION = "Nutrition data: USDA FoodData Central";

// Grams per 1 unit — mass/weight units only. No density assumptions for volume.
const MASS_G: Record<string, number> = {
  g: 1, gram: 1, grams: 1,
  kg: 1000, kilogram: 1000, kilograms: 1000,
  mg: 0.001, milligram: 0.001, milligrams: 0.001,
  oz: 28.35, ounce: 28.35, ounces: 28.35,
  lb: 453.59, lbs: 453.59, pound: 453.59, pounds: 453.59,
};

// Fixed-mass fallbacks for tiny culinary volumes (no density needed).
const PINCH_G: Record<string, number> = {
  pinch: 0.36,
  dash: 0.6,
  smidge: 0.17,
};

// Map common abbreviations to the canonical term found in FDC portion modifiers.
const UNIT_CANONICAL: Record<string, string> = {
  tbsp: "tablespoon", tbs: "tablespoon", tablespoons: "tablespoon",
  tsp: "teaspoon", teaspoons: "teaspoon",
  cups: "cup",
  cloves: "clove",
  slices: "slice",
  pieces: "piece", pcs: "piece", pc: "piece",
  stalks: "stalk",
  ribs: "rib",
  heads: "head",
  bunches: "bunch",
  sprigs: "sprig",
};

const SKIP_TERMS = ["to taste", "as needed", "for garnish", "optional"];

type FoodPortion = { modifier: string; gramWeight: number };

export type NutritionTier = "catalog" | "usda" | "estimate";

export type NutritionResult = {
  kcalPerServing: number | null; // null = unresolved with no usable estimate
  tier: NutritionTier;
};

// Extract the leading numeric value from a portion modifier like "2 tablespoons" → 2.
function numericPrefix(text: string): number {
  const m = text.match(/^(\d+(?:\.\d+)?)\s*/);
  return m ? parseFloat(m[1]) : 1;
}

// Convert qty of unit to grams using mass table, pinch table, or FDC food portions.
// Returns null when conversion is impossible (caller must flag as unresolved).
export function toGrams(qty: number, unit: string, portions: FoodPortion[]): number | null {
  if (qty <= 0) return 0;
  const u = unit.toLowerCase().trim();

  // 1. Mass units — exact.
  if (u in MASS_G) return qty * MASS_G[u];

  // 2. Pinch / dash — fixed approximate mass.
  if (u in PINCH_G) return qty * PINCH_G[u];

  // 3. FDC food portions — per-food volume → grams.
  //    Build candidate terms: canonical form, original, simple singularize.
  const cu = UNIT_CANONICAL[u] ?? u;
  const candidates = [...new Set([cu, u, u.replace(/s$/, "")])].filter(Boolean);

  for (const cand of candidates) {
    for (const p of portions) {
      if (p.modifier.toLowerCase().includes(cand)) {
        const factor = numericPrefix(p.modifier);
        return qty * (p.gramWeight / Math.max(factor, 0.001));
      }
    }
  }

  return null;
}

// ---- Internal ingredient result type ----
type IngResult =
  | { kind: "ok"; kcalPer100g: number; grams: number; tier: "catalog" | "usda" }
  | { kind: "skip" }
  | { kind: "unresolved" };

async function fetchNutritionApi(
  ingredient: string,
  token: string,
): Promise<{ hit: boolean; kcal_per_100g?: number; foodPortions?: FoodPortion[]; miss_reason?: string } | null> {
  try {
    const r = await fetch("/api/nutrition", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ mode: "name", ingredient }),
    });
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

// Resolve kcal/serving for a generated meal.
// Deduplicates ingredients by normalized name, fires all lookups in parallel,
// and returns the computed result with a source tier badge.
export async function resolveNutrition(
  meal: { ingredients: any[]; servings: number; estKcalPerServing?: number | null },
  token: string,
): Promise<NutritionResult> {
  const servings = Math.max(1, meal.servings || 1);

  // Deduplicate by normalized name; preserve first occurrence's qty/unit.
  const seen = new Set<string>();
  const uniqueIngs: Array<{ key: string; name: string; qty: number; unit: string }> = [];
  for (const ing of meal.ingredients ?? []) {
    const name = String(ing.name || "").trim();
    if (!name) continue;
    const key = normalizeIngName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const ra = ing.recipeAmount ?? {};
    uniqueIngs.push({ key, name, qty: Number(ra.qty) || 0, unit: String(ra.unit || "").trim() });
  }

  // Fire USDA API and catalog queries in parallel.
  const [nutritionResponses, catalogKcals] = await Promise.all([
    Promise.all(
      uniqueIngs.map((ing) => {
        if (SKIP_TERMS.some((t) => ing.name.toLowerCase().includes(t) || ing.unit.toLowerCase().includes(t))) {
          return Promise.resolve(null);
        }
        return fetchNutritionApi(ing.name, token);
      }),
    ),
    Promise.all(
      uniqueIngs.map((ing) =>
        supabase
          .from("catalog")
          .select("kcal_per_100g")
          .eq("normalized_name", ing.key)       // generic ingredient lookup column
          .not("kcal_per_100g", "is", null)
          .limit(1)                             // normalized_name is non-unique (TER-202)
          .maybeSingle()
          .then(
            ({ data }) => (data?.kcal_per_100g as number | null) ?? null,
            () => null as number | null,
          ),
      ),
    ),
  ]);

  // Resolve each ingredient to a result.
  const ingResults: IngResult[] = uniqueIngs.map((ing, i) => {
    // Skip by name/unit.
    if (SKIP_TERMS.some((t) => ing.name.toLowerCase().includes(t) || ing.unit.toLowerCase().includes(t))) {
      return { kind: "skip" };
    }

    const nutRes = nutritionResponses[i];
    const catalogKcal = catalogKcals[i];

    // API reported this ingredient should be skipped (e.g., "salt to taste").
    if (nutRes?.hit === false && nutRes.miss_reason === "skip") {
      return { kind: "skip" };
    }

    const portions: FoodPortion[] = nutRes?.foodPortions ?? [];
    const grams = toGrams(ing.qty, ing.unit, portions);
    if (grams === null) return { kind: "unresolved" };

    // Catalog kcal takes priority; fall back to USDA.
    if (catalogKcal != null) {
      return { kind: "ok", kcalPer100g: catalogKcal, grams, tier: "catalog" };
    }
    if (nutRes?.hit && nutRes.kcal_per_100g != null) {
      return { kind: "ok", kcalPer100g: nutRes.kcal_per_100g, grams, tier: "usda" };
    }

    // No kcal data (API miss or network failure).
    return { kind: "unresolved" };
  });

  // Any material ingredient unresolved → fall back to LLM estimate.
  // Return null (not 0) when the estimate is also absent — never fabricate a number.
  const hasUnresolved = ingResults.some((r) => r.kind === "unresolved");
  if (hasUnresolved) {
    const est = meal.estKcalPerServing;
    return { kcalPerServing: est && est > 0 ? est : null, tier: "estimate" };
  }

  // All skipped (entirely "to taste" ingredients) → fall back to estimate.
  if (ingResults.every((r) => r.kind === "skip")) {
    const est = meal.estKcalPerServing;
    return { kcalPerServing: est && est > 0 ? est : null, tier: "estimate" };
  }

  // Sum computed kcal; track weakest tier.
  let totalKcal = 0;
  let weakestTier: "catalog" | "usda" = "catalog";
  for (const r of ingResults) {
    if (r.kind !== "ok") continue;
    totalKcal += (r.grams * r.kcalPer100g) / 100;
    if (r.tier === "usda") weakestTier = "usda";
  }

  return { kcalPerServing: Math.round(totalKcal / servings), tier: weakestTier };
}

// ---- Module-level assertions (run at import time, fail loudly if logic drifts) ----
function _assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`nutritionResolve assertion: ${msg}`);
}

const _p: FoodPortion[] = [
  { modifier: "1 clove", gramWeight: 3 },
  { modifier: "1 tablespoon", gramWeight: 8 },
  { modifier: "2 tablespoons", gramWeight: 30 },
  { modifier: "1 cup", gramWeight: 125 },
];

// "2 clove" w/ a clove=3g portion → 6g
_assert(toGrams(2, "clove", _p) === 6, "2 cloves × 3g → 6g");
// "1 lb" → 453.59g
_assert(toGrams(1, "lb", []) === 453.59, "1 lb → 453.59g");
// "3 oz" → 85.05g
_assert(toGrams(3, "oz", []) === 3 * 28.35, "3 oz → 85.05g");
// "1 cup" via portion → 125g
_assert(toGrams(1, "cup", _p) === 125, "1 cup → 125g via portion");
// "1 tbsp" canonical → matches "1 tablespoon" portion → 8g
_assert(toGrams(1, "tbsp", _p) === 8, "1 tbsp → 8g via tablespoon portion");
// "2 tbsp" against "2 tablespoons=30g" → 30g (factor=2, grams_per_tbsp=15, qty=2 → 30)
_assert(
  toGrams(2, "tbsp", [{ modifier: "2 tablespoons", gramWeight: 30 }]) === 30,
  "2 tbsp against 2 tablespoons=30g → 30g",
);
// Unresolved unit → null
_assert(toGrams(1, "can", []) === null, "unresolved unit → null");
// qty=0 → 0 regardless of unit
_assert(toGrams(0, "cup", _p) === 0, "qty 0 → 0g");
