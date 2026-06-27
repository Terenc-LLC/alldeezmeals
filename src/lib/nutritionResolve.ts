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

// Volume-unit canonical names for the standard-portion fallback (TER-502).
const STD_VOL_CANONICAL: Record<string, "tsp" | "tbsp" | "cup"> = {
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  tbsp: "tbsp", tbs: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  cup: "cup", cups: "cup",
};

type VolumePortion = { tsp?: number; tbsp?: number; cup?: number };

// Curated per-ingredient volume→gram table (TER-502). Sorted longest-key-first so the
// most-specific entry wins (e.g. "brown sugar" beats "sugar", "shredded cheddar" beats "shredded cheese").
const STD_PORTIONS: Array<[string, VolumePortion]> = ([
  // Oils
  ["olive oil", { tsp: 4.5, tbsp: 13.5 }],
  ["vegetable oil", { tsp: 4.5, tbsp: 13.5 }],
  ["canola oil", { tsp: 4.5, tbsp: 13.5 }],
  ["sesame oil", { tsp: 4.5, tbsp: 13.5 }],
  ["avocado oil", { tsp: 4.5, tbsp: 13.5 }],
  // Fats
  ["butter", { tsp: 4.7, tbsp: 14 }],
  // Acids
  ["lemon juice", { tsp: 5, tbsp: 15 }],
  ["lime juice", { tsp: 5, tbsp: 15 }],
  ["vinegar", { tsp: 5, tbsp: 15 }],
  // Condiments
  ["soy sauce", { tsp: 5.3, tbsp: 16 }],
  ["fish sauce", { tbsp: 18 }],
  ["honey", { tsp: 7, tbsp: 21 }],
  ["ketchup", { tbsp: 17 }],
  ["mustard", { tsp: 5, tbsp: 15 }],
  ["mayonnaise", { tbsp: 14, cup: 220 }],
  ["mayo", { tbsp: 14, cup: 220 }],
  ["cornstarch", { tsp: 2.7, tbsp: 8 }],
  // Sugars — "brown sugar" must precede "sugar" (longer key)
  ["brown sugar", { tsp: 4.6, tbsp: 13.8 }],
  ["sugar", { tsp: 4.2, tbsp: 12.5 }],
  // Ground spices
  ["garlic powder", { tsp: 2.6, tbsp: 7.8 }],
  ["onion powder", { tsp: 2.6, tbsp: 7.8 }],
  ["chili powder", { tsp: 2.6, tbsp: 7.8 }],
  ["curry powder", { tsp: 2.6, tbsp: 7.8 }],
  ["ground ginger", { tsp: 2.6, tbsp: 7.8 }],
  ["cumin", { tsp: 2.6, tbsp: 7.8 }],
  ["paprika", { tsp: 2.6, tbsp: 7.8 }],
  ["cinnamon", { tsp: 2.6, tbsp: 7.8 }],
  ["coriander", { tsp: 2.6, tbsp: 7.8 }],
  ["cayenne", { tsp: 2.6, tbsp: 7.8 }],
  ["turmeric", { tsp: 2.6, tbsp: 7.8 }],
  // Dried leafy herbs / flakes
  ["italian seasoning", { tsp: 1, tbsp: 3 }],
  ["red pepper flakes", { tsp: 1, tbsp: 3 }],
  ["crushed red pepper", { tsp: 1, tbsp: 3 }],
  ["oregano", { tsp: 1, tbsp: 3 }],
  ["thyme", { tsp: 1, tbsp: 3 }],
  ["basil", { tsp: 1, tbsp: 3 }],
  ["parsley", { tsp: 1, tbsp: 3 }],
  // Seeds
  ["sesame seeds", { tsp: 3, tbsp: 9 }],
  // Dairy
  ["greek yogurt", { tbsp: 15, cup: 245 }],
  ["sour cream", { tbsp: 14, cup: 230 }],
  // Shredded cheese — compound keys; longest wins
  ["shredded mozzarella", { tbsp: 7, cup: 113 }],
  ["shredded cheddar", { tbsp: 7, cup: 113 }],
  ["shredded cabbage", { cup: 70 }],
  ["shredded chicken", { cup: 140 }],
  ["shredded mexican", { tbsp: 7, cup: 113 }],
  ["shredded carrot", { cup: 110 }],
  ["shredded cheese", { tbsp: 7, cup: 113 }],
  // Produce / slaw
  ["cherry tomato", { cup: 150 }],
  ["grated carrot", { cup: 110 }],
  ["coleslaw", { cup: 70 }],
  ["slaw mix", { cup: 70 }],
  // Liquids
  ["broth", { cup: 240 }],
  ["stock", { cup: 240 }],
  ["ranch", { tbsp: 15, cup: 240 }],
] as Array<[string, VolumePortion]>).sort((a, b) => b[0].length - a[0].length);

const SKIP_TERMS = ["to taste", "as needed", "for garnish", "optional"];

type FoodPortion = { modifier: string; gramWeight: number };

export type NutritionTier = "catalog" | "usda" | "estimate";

export type Macros = { protein_g: number; fat_g: number; carbs_g: number };

export type NutritionResult = {
  kcalPerServing: number | null; // null = unresolved with no usable estimate
  tier: NutritionTier;
  // TER-493: macros per serving — real when every contributing ingredient carries
  // macros AND Calories resolved; estimated (estMacrosPerServing) otherwise; null when
  // neither real nor estimated macros exist (never fabricated).
  macrosPerServing: Macros | null;
  macrosEstimated: boolean;
};

// Coerce arbitrary JSON (catalog row / API response) into a clean Macros or null.
function coerceMacros(m: any): Macros | null {
  if (!m || typeof m !== "object") return null;
  const protein_g = Number(m.protein_g);
  const fat_g = Number(m.fat_g);
  const carbs_g = Number(m.carbs_g);
  if (![protein_g, fat_g, carbs_g].every((x) => Number.isFinite(x))) return null;
  return { protein_g, fat_g, carbs_g };
}

function roundMacros(m: Macros): Macros {
  return {
    protein_g: Math.round(m.protein_g),
    fat_g: Math.round(m.fat_g),
    carbs_g: Math.round(m.carbs_g),
  };
}

// Extract the leading numeric value from a portion modifier like "2 tablespoons" → 2.
function numericPrefix(text: string): number {
  const m = text.match(/^(\d+(?:\.\d+)?)\s*/);
  return m ? parseFloat(m[1]) : 1;
}

// Convert qty of unit to grams using mass table, pinch table, FDC portions, or the
// standard-portion fallback table. Returns null when conversion is impossible.
export function toGrams(qty: number, unit: string, portions: FoodPortion[], ingredient?: string): number | null {
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

  // 4. Standard-portion fallback — curated per-ingredient volume densities (TER-502).
  //    FDC still wins (step 3 above). Unlisted ingredient×unit → null (unchanged).
  if (ingredient) {
    const stdUnit = STD_VOL_CANONICAL[u];
    if (stdUnit) {
      const normIng = ingredient
        .toLowerCase()
        .replace(/\s*\([^)]*\)\s*/g, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      for (const [key, row] of STD_PORTIONS) {
        if (normIng.includes(key)) {
          const gPerUnit = row[stdUnit];
          if (gPerUnit != null) return Math.round(qty * gPerUnit * 10000) / 10000;
          break; // matched key but no entry for this unit → null
        }
      }
    }
  }

  return null;
}

// ---- Internal ingredient result type ----
type IngResult =
  | { kind: "ok"; kcalPer100g: number; macrosPer100g: Macros | null; grams: number; tier: "catalog" | "usda" }
  | { kind: "skip" }
  | { kind: "unresolved" };

async function fetchNutritionApi(
  ingredient: string,
  token: string,
): Promise<{ hit: boolean; kcal_per_100g?: number; macros?: any; foodPortions?: FoodPortion[]; miss_reason?: string } | null> {
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

// TER-493: lazy-pull catalog nutrition by representative UPC for an ingredient whose
// direct catalog lookup came back empty. Fired only for catalog misses (populated
// ingredients stay a cheap direct read). Returns existing nutrition if present, else
// probes UPC-bearing rows and persists the first FDC/OFF hit onto the catalog row.
async function fetchCatalogPull(
  normalizedName: string,
  token: string,
): Promise<{ hit: boolean; kcal_per_100g?: number; macros?: any } | null> {
  try {
    const r = await fetch("/api/catalog-nutrition-pull", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ normalizedName }),
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
  meal: { ingredients: any[]; servings: number; estKcalPerServing?: number | null; estMacrosPerServing?: Macros | null },
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

  const isSkip = (ing: { name: string; unit: string }) =>
    SKIP_TERMS.some((t) => ing.name.toLowerCase().includes(t) || ing.unit.toLowerCase().includes(t));

  type CatRes = { kcal: number; macros: Macros | null };

  // Fire USDA API and catalog queries in parallel.
  const [nutritionResponses, catalogRows] = await Promise.all([
    Promise.all(
      uniqueIngs.map((ing) => {
        if (isSkip(ing)) return Promise.resolve(null);
        return fetchNutritionApi(ing.name, token);
      }),
    ),
    Promise.all(
      uniqueIngs.map((ing) =>
        supabase
          .from("catalog")
          .select("kcal_per_100g, macros, serving_g")
          .eq("normalized_name", ing.key)       // generic ingredient lookup column
          .not("kcal_per_100g", "is", null)
          .limit(1)                             // normalized_name is non-unique (TER-202)
          .maybeSingle()
          .then(
            ({ data }): CatRes | null =>
              data?.kcal_per_100g != null
                ? { kcal: data.kcal_per_100g as number, macros: coerceMacros(data.macros) }
                : null,
            () => null as CatRes | null,
          ),
      ),
    ),
  ]);

  // TER-493: lazy-pull by UPC only for catalog misses (non-skip ingredients with no
  // populated catalog row). Fired in parallel; populated ingredients stay a cheap read.
  const pullRows: Array<CatRes | null> = await Promise.all(
    uniqueIngs.map((ing, i) => {
      if (isSkip(ing) || catalogRows[i] != null) return Promise.resolve(null as CatRes | null);
      return fetchCatalogPull(ing.key, token).then((res): CatRes | null =>
        res?.hit && res.kcal_per_100g != null
          ? { kcal: Number(res.kcal_per_100g), macros: coerceMacros(res.macros) }
          : null,
      );
    }),
  );

  // Resolve each ingredient to a result.
  const ingResults: IngResult[] = uniqueIngs.map((ing, i) => {
    // Skip by name/unit.
    if (isSkip(ing)) {
      return { kind: "skip" };
    }

    const nutRes = nutritionResponses[i];
    const catRes = catalogRows[i] ?? pullRows[i];

    // API reported this ingredient should be skipped (e.g., "salt to taste").
    if (nutRes?.hit === false && nutRes.miss_reason === "skip") {
      return { kind: "skip" };
    }

    const portions: FoodPortion[] = nutRes?.foodPortions ?? [];
    const grams = toGrams(ing.qty, ing.unit, portions, ing.name);
    if (grams === null) return { kind: "unresolved" };

    // Catalog (incl. lazy-pull) kcal takes priority; fall back to USDA. Carry macros.
    if (catRes != null) {
      return { kind: "ok", kcalPer100g: catRes.kcal, macrosPer100g: catRes.macros, grams, tier: "catalog" };
    }
    if (nutRes?.hit && nutRes.kcal_per_100g != null) {
      return { kind: "ok", kcalPer100g: nutRes.kcal_per_100g, macrosPer100g: coerceMacros(nutRes.macros), grams, tier: "usda" };
    }

    // No kcal data (API miss or network failure).
    return { kind: "unresolved" };
  });

  // Estimate-tier fallback (Calories AND macros): used when any material ingredient is
  // unresolved or every ingredient is skipped. Never fabricate — null when the estimate
  // is absent too.
  const estResult = (): NutritionResult => {
    const est = meal.estKcalPerServing;
    const em = coerceMacros(meal.estMacrosPerServing);
    return {
      kcalPerServing: est && est > 0 ? est : null,
      tier: "estimate",
      macrosPerServing: em ? roundMacros(em) : null,
      macrosEstimated: em != null,
    };
  };

  // Any material ingredient unresolved → fall back to LLM estimate.
  if (ingResults.some((r) => r.kind === "unresolved")) return estResult();

  // All skipped (entirely "to taste" ingredients) → fall back to estimate.
  if (ingResults.every((r) => r.kind === "skip")) return estResult();

  // Sum computed kcal + macro grams; track weakest tier and macro completeness.
  let totalKcal = 0;
  let weakestTier: "catalog" | "usda" = "catalog";
  const macroTotal: Macros = { protein_g: 0, fat_g: 0, carbs_g: 0 };
  let allHaveMacros = true;
  for (const r of ingResults) {
    if (r.kind !== "ok") continue;
    totalKcal += (r.grams * r.kcalPer100g) / 100;
    if (r.tier === "usda") weakestTier = "usda";
    if (r.macrosPer100g) {
      macroTotal.protein_g += (r.grams * r.macrosPer100g.protein_g) / 100;
      macroTotal.fat_g += (r.grams * r.macrosPer100g.fat_g) / 100;
      macroTotal.carbs_g += (r.grams * r.macrosPer100g.carbs_g) / 100;
    } else {
      allHaveMacros = false;
    }
  }

  // Honest macros: real only if every contributing ingredient carries macros; otherwise
  // fall back to the meal's estimate (marked estimated), or null when none exists.
  let macrosPerServing: Macros | null;
  let macrosEstimated: boolean;
  if (allHaveMacros) {
    macrosPerServing = roundMacros({
      protein_g: macroTotal.protein_g / servings,
      fat_g: macroTotal.fat_g / servings,
      carbs_g: macroTotal.carbs_g / servings,
    });
    macrosEstimated = false;
  } else {
    const em = coerceMacros(meal.estMacrosPerServing);
    macrosPerServing = em ? roundMacros(em) : null;
    macrosEstimated = em != null;
  }

  return { kcalPerServing: Math.round(totalKcal / servings), tier: weakestTier, macrosPerServing, macrosEstimated };
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

// ---- Standard-portion fallback assertions (TER-502) ----
// Basic lookups
_assert(toGrams(1, "tbsp", [], "olive oil") === 13.5, "1 tbsp olive oil → 13.5g");
_assert(toGrams(3, "tsp", [], "garlic powder") === 7.8, "3 tsp garlic powder → 7.8g");
_assert(toGrams(1, "tbsp", [], "honey") === 21, "1 tbsp honey → 21g");
_assert(toGrams(1, "cup", [], "shredded cheddar cheese") === 113, "1 cup shredded cheddar cheese → 113g");
_assert(toGrams(1, "cup", [], "chicken broth") === 240, "1 cup chicken broth → 240g");
_assert(toGrams(2, "tbsp", [], "soy sauce") === 32, "2 tbsp soy sauce → 32g");
// Most-specific key wins: "brown sugar" before "sugar"
_assert(toGrams(1, "tbsp", [], "brown sugar") === 13.8, "brown sugar before sugar → 13.8g");
// FDC precedence: cup portion present → FDC wins over table (sour cream table=230, FDC=125)
_assert(
  toGrams(1, "cup", [{ modifier: "1 cup", gramWeight: 125 }], "sour cream") === 125,
  "FDC portion wins over std-portion table",
);
// No match → null
_assert(toGrams(1, "cup", [], "rutabaga") === null, "no table match → null");
