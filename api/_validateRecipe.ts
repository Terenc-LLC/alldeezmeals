// TER-335: Server-side recipe validation gate.
// Pure TS, no browser/node-only deps, no imports from src/.

export interface ValidationResult {
  ok: boolean;
  hardFailures: string[];
  softFailures: string[];
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toMl(qty: number, unit: string): number | null {
  switch (unit.toLowerCase().trim()) {
    case "tsp": case "teaspoon": case "teaspoons": return qty * 4.93;
    case "tbsp": case "tablespoon": case "tablespoons": case "tbs": return qty * 14.79;
    case "cup": case "cups": return qty * 236.6;
    case "fl oz": case "floz": return qty * 29.57;
    case "ml": case "milliliter": case "milliliters": case "millilitre": return qty;
    case "l": case "liter": case "liters": case "litre": case "litres": return qty * 1000;
    default: return null;
  }
}

function toGrams(qty: number, unit: string): number | null {
  switch (unit.toLowerCase().trim()) {
    case "g": case "gram": case "grams": return qty;
    case "kg": case "kilogram": case "kilograms": return qty * 1000;
    case "oz": case "ounce": case "ounces": return qty * 28.35;
    case "lb": case "lbs": case "pound": case "pounds": return qty * 453.6;
    default: return null;
  }
}

type IngCategory = "salt" | "oil_butter" | "sugar" | "protein" | "liquid" | "other";

function categorize(name: string, category: string): IngCategory {
  const n = name.toLowerCase();
  const c = (category ?? "").toLowerCase();
  if (n.includes("salt")) return "salt";
  if (n.includes("oil") || n.includes("butter") || n.includes("margarine") ||
      n.includes("lard") || n.includes("ghee") || n.includes("shortening")) return "oil_butter";
  if (n.includes("sugar") || n.includes("honey") || n.includes("syrup") ||
      n.includes("agave") || n.includes("molasses")) return "sugar";
  if (c.includes("meat") || c.includes("poultry") || c.includes("seafood") || c.includes("protein") ||
      n.includes("chicken") || n.includes("beef") || n.includes("pork") || n.includes("turkey") ||
      n.includes("lamb") || n.includes("salmon") || n.includes("shrimp") || n.includes("tuna") ||
      n.includes("tofu") || n.includes("tempeh") || n.includes("fish") || n.includes("steak") ||
      n.includes("sausage") || n.includes("bacon") || n.includes("ham")) return "protein";
  if (n.includes("water") || n.includes("broth") || n.includes("stock") ||
      n.includes("milk") || n.includes("cream") || n.includes("juice") ||
      n.includes("wine") || n.includes("beer") || n.includes("coconut milk")) return "liquid";
  return "other";
}

// Per-serving ceilings in ml and g (null = not applicable for that unit type).
const CEILINGS: Record<IngCategory, { ml: number | null; g: number | null }> = {
  salt:       { ml: 4.93,  g: 6 },     // 1 tsp
  oil_butter: { ml: 29.58, g: 28 },    // 2 tbsp
  sugar:      { ml: 44.37, g: 37.5 },  // 3 tbsp
  protein:    { ml: null,  g: 250 },
  liquid:     { ml: 473.2, g: null },   // 2 cups
  other:      { ml: null,  g: null },
};

const STAPLES = new Set(["salt", "pepper", "oil", "water", "butter"]);

export function validateRecipe(recipe: any): ValidationResult {
  const hardFailures: string[] = [];
  const softFailures: string[] = [];

  if (typeof recipe !== "object" || recipe === null || Array.isArray(recipe)) {
    hardFailures.push("not_object: recipe is not a plain object");
    return { ok: false, hardFailures, softFailures };
  }

  const { name, description, cuisine, servings, steps, ingredients, estKcalPerServing } = recipe;

  if (!name || typeof name !== "string" || !name.trim()) {
    hardFailures.push("name_missing: recipe name is missing or empty");
  }

  const stepsValid = Array.isArray(steps) && steps.every((s: any) => typeof s === "string");
  if (!stepsValid) {
    hardFailures.push("steps_invalid: steps must be an array of strings");
  } else {
    if (steps.length < 2) {
      hardFailures.push(`steps_floor: only ${steps.length} step(s) (min 2)`);
    }
    const shortIdx = steps.findIndex((s: string) => s.trim().length < 15);
    if (shortIdx >= 0) {
      hardFailures.push(`step_too_short: step ${shortIdx + 1} is shorter than 15 characters`);
    }
  }

  const ingsValid = Array.isArray(ingredients) &&
    ingredients.every((i: any) => typeof i === "object" && i !== null && !Array.isArray(i));
  if (!ingsValid) {
    hardFailures.push("ingredients_invalid: ingredients must be an array of objects");
  } else {
    if (ingredients.length < 3) {
      hardFailures.push(`ingredient_floor: only ${ingredients.length} ingredient(s) (min 3)`);
    }
    for (let i = 0; i < ingredients.length; i++) {
      const ing = ingredients[i];
      if (!ing.name || typeof ing.name !== "string" || !ing.name.trim()) {
        hardFailures.push(`ingredient_no_name: ingredient at index ${i} has no name`);
      }
      const qty = ing?.recipeAmount?.qty;
      const src = ing?.source;
      if (src !== "staple" && (typeof qty !== "number" || !(qty > 0))) {
        hardFailures.push(`ingredient_bad_qty: ingredient "${ing.name ?? i}" has invalid quantity (must be number > 0)`);
      }
    }
  }

  // Soft checks — independent of structural validity
  if (!description || typeof description !== "string" || !description.trim()) {
    softFailures.push("description_empty: description is missing or empty");
  }
  if (!cuisine || typeof cuisine !== "string" || !cuisine.trim()) {
    softFailures.push("cuisine_empty: cuisine is missing or empty");
  }
  if (typeof servings !== "number" || !Number.isInteger(servings) || servings <= 0) {
    softFailures.push(`servings_invalid: servings is not a positive integer (got ${JSON.stringify(servings)})`);
  }
  if (typeof estKcalPerServing === "number" && (estKcalPerServing < 150 || estKcalPerServing > 1500)) {
    softFailures.push(`kcal_implausible: estKcalPerServing ${estKcalPerServing} is outside 150–1500`);
  }

  // Per-ingredient checks (only when both arrays are structurally valid)
  if (ingsValid && stepsValid) {
    const stepsText = (steps as string[]).join(" ").toLowerCase();
    const srv = (typeof servings === "number" && servings > 0) ? servings : 1;

    for (const ing of ingredients as any[]) {
      const ingName = String(ing.name ?? "").trim();
      const unit = ing?.recipeAmount?.unit;
      const qty = ing?.recipeAmount?.qty;

      // SOFT: missing unit (countable items legitimately omit it)
      if (!unit || typeof unit !== "string" || !unit.trim()) {
        softFailures.push(`ingredient_no_unit: ingredient "${ingName}" is missing recipeAmount.unit`);
      }

      // SOFT: orphan ingredient (not mentioned in any step, excluding staples)
      const normName = normalize(ingName);
      const isStaple = [...STAPLES].some((s) => normName === s || normName.includes(s));
      if (!isStaple) {
        const words = normName.split(" ").filter((w) => w.length > 2);
        if (words.length > 0 && !words.some((w) => stepsText.includes(w))) {
          softFailures.push(`orphan_ingredient: "${ingName}" does not appear in any step`);
        }
      }

      // SOFT/HARD: quantity implausible — ceiling scaled by servings
      if (typeof qty === "number" && qty > 0 && unit && typeof unit === "string" && unit.trim()) {
        const cat = categorize(ingName, ing.category ?? "");
        const ceiling = CEILINGS[cat];
        const totalCeilingMl = ceiling.ml !== null ? ceiling.ml * srv : null;
        const totalCeilingG = ceiling.g !== null ? ceiling.g * srv : null;
        const actualMl = toMl(qty, unit);
        const actualG = toGrams(qty, unit);

        let ratio: number | null = null;
        if (actualMl !== null && totalCeilingMl !== null) {
          ratio = actualMl / totalCeilingMl;
        } else if (actualG !== null && totalCeilingG !== null) {
          ratio = actualG / totalCeilingG;
        }

        if (ratio !== null && ratio > 1) {
          if (ratio > 10) {
            hardFailures.push(`qty_extreme: ingredient "${ingName}" quantity is over 10× the per-serving ceiling`);
          } else {
            softFailures.push(`qty_implausible: ingredient "${ingName}" quantity exceeds the per-serving ceiling`);
          }
        }
      }
    }
  }

  return { ok: hardFailures.length === 0, hardFailures, softFailures };
}
