// Shared FDC/OFF GTIN nutrition lookup. Underscore prefix => not a Vercel route.
// Extracted from api/nutrition.ts (TER-493) so /api/nutrition and the catalog
// lazy-pull endpoint share a single source for the FDC Branded + Open Food Facts
// GTIN path. Pure move — no behavior change.

import { normalizeGtin } from "../src/lib/normalize.js";

export const FDC_BASE = "https://api.nal.usda.gov/fdc/v1";
export const OFF_BASE = "https://world.openfoodfacts.org/api/v0";

export const USDA_ATTRIBUTION = "Nutrition data: USDA FoodData Central";
export const OFF_ATTRIBUTION = "Nutrition data: Open Food Facts (ODbL)";

export type FoodPortion = { modifier: string; gramWeight: number };

export type NutritionResult = {
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

// Three-way discriminated outcome for lookup helpers.
// "miss"  = searched successfully, nothing usable matched (cacheable).
// "error" = upstream unreachable / non-2xx / parse failure (NOT cacheable).
export type LookupOutcome =
  | { status: "hit"; data: NutritionResult }
  | { status: "miss" }
  | { status: "error" };

export function extractNutrients(
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

export async function fetchFdcDetail(fdcId: number | string, apiKey: string): Promise<any | null> {
  const r = await fetch(`${FDC_BASE}/food/${fdcId}?api_key=${encodeURIComponent(apiKey)}`);
  if (!r.ok) return null;
  return r.json();
}

// offBarcode: digits-only, no padding — used for OFF URL (OFF stores barcodes as-printed).
// canonicalGtin: 14-digit padded — used for FDC comparison, result.gtin, and cache key.
export async function lookupByGtin(offBarcode: string, canonicalGtin: string, apiKey: string): Promise<LookupOutcome> {
  // fdcDefinitive = true when FDC returned 2xx and confirmed no GTIN match (definitive miss).
  // If FDC is unreachable / non-2xx we must still try OFF — do not skip it on a rate-limit.
  let fdcDefinitive = false;

  try {
    const fdcUrl =
      `${FDC_BASE}/foods/search?query=${encodeURIComponent(canonicalGtin)}` +
      `&dataType=Branded&pageSize=5&api_key=${encodeURIComponent(apiKey)}`;
    const fdcR = await fetch(fdcUrl);
    if (fdcR.ok) {
      const fdcData = await fdcR.json();
      const foods: any[] = fdcData.foods ?? [];
      const match = foods.find((f: any) => f.gtinUpc && normalizeGtin(f.gtinUpc) === canonicalGtin);
      if (!match) {
        // FDC searched successfully and confirmed this GTIN is absent — definitive miss from FDC.
        fdcDefinitive = true;
      } else {
        // GTIN found; attempt detail fetch. A failure here is a transient error, not a miss.
        try {
          const detail = await fetchFdcDetail(match.fdcId, apiKey);
          if (detail) {
            const nutrients = extractNutrients(detail.foodNutrients ?? []);
            if (nutrients) {
              const servingSize = detail.servingSize;
              const servingUnit = detail.servingSizeUnit ?? "";
              const servingBasis =
                servingSize != null ? `${servingSize}${servingUnit}` : undefined;
              return {
                status: "hit",
                data: {
                  kcal_per_100g: nutrients.kcal_per_100g,
                  ...(servingBasis ? { serving_basis: servingBasis } : {}),
                  ...(nutrients.macros ? { macros: nutrients.macros } : {}),
                  fdcId: detail.fdcId,
                  gtin: canonicalGtin,
                  dataType: "Branded",
                  source: "usda",
                  attribution: USDA_ATTRIBUTION,
                },
              };
            }
          }
          // detail null (non-2xx) or no kcal: fall through to OFF
        } catch {
          // detail fetch threw: fall through to OFF
        }
      }
    }
    // FDC non-2xx: fdcDefinitive stays false; fall through to OFF
  } catch (e: any) {
    console.error("FDC GTIN fetch failed:", canonicalGtin, e?.message);
    // network error: fall through to OFF
  }

  // Open Food Facts fallback (keyless).
  // Uses offBarcode (digits-only, no padding) — OFF resolves barcodes as-printed.
  // offDefinitive = true when OFF returned 2xx (regardless of whether it had the product).
  let offDefinitive = false;
  try {
    const offR = await fetch(`${OFF_BASE}/product/${offBarcode}.json`);
    if (offR.ok) {
      offDefinitive = true;
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
            status: "hit",
            data: {
              kcal_per_100g: kcal,
              ...(macros ? { macros } : {}),
              gtin: canonicalGtin,
              dataType: "Branded",
              source: "off",
              attribution: OFF_ATTRIBUTION,
            },
          };
        }
      }
      // OFF 2xx but product absent or no kcal: offDefinitive already true (definitive miss).
    }
    // OFF non-2xx: offDefinitive stays false
  } catch (e: any) {
    console.error("OFF GTIN fetch failed:", offBarcode, e?.message);
  }

  // At least one source gave a definitive 2xx answer → genuine no-match (cacheable miss).
  // Neither source reachable → transient error (do not cache; caller should retry).
  if (fdcDefinitive || offDefinitive) return { status: "miss" };
  return { status: "error" };
}
