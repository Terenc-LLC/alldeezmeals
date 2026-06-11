// TER-400: Ingredient-flow graph — validate + auto-repair the reuse/buy-source invariant.
//
// A committed week's recipes carry a two-dimension ingredient model:
//   - shopping dimension: `source` ("buy" | "reused" | "staple") — does this meal put the
//     item on the shopping list, pull it from another meal's pack, or assume it's in the pantry?
//   - cook-mode dimension: `preparedEarlier` (boolean) — was it prepped/cooked in an earlier
//     meal this week? Independent of `source`; never touched by repair.
//
// Invariant (P1): every ingredient marked "reused" in ≥1 meal must have a supply source
// somewhere in the week — a meal that buys it, or a "staple" claim (pantry-on-hand, which
// the list-builder excludes by design). Without one, the shopping list and the Instacart
// handoff silently omit the ingredient and the week is uncookable.
//
// Quantity-sufficiency (does the buy cover all reuses?) is a stretch goal, out of scope here.
//
// Future `construct` mode (TER-303): this graph is the substrate for deterministic week
// assembly from the recipe library — given N banked recipes, recompute each ingredient's
// shopping dimension from scratch (earliest use buys, later uses reuse) instead of trusting
// the flags generated for the recipes' original weeks. validate/repair are the degenerate
// "trust then patch" form of that; construct mode is NOT built in this module yet, but new
// code should keep these functions pure and week-shape-agnostic so it can be.
//
// Pure TypeScript, no React deps. Ingredient identity is `normalizeIngName` (the generic
// ingredient normalizer — NOT the `normalized_product` product-name normalizer in
// api/ingest-order.ts).

import { normalizeIngName } from "./normalize";

export type FlowSource = "buy" | "reused" | "staple";

export type FlowIngredient = {
  name: string;
  recipeAmount?: { qty: number; unit: string };
  source?: FlowSource;
  preparedEarlier?: boolean;
  purchaseSize?: string;
  purchaseQty?: number;
  [key: string]: any;
};

export type FlowRecipe = {
  name?: string;
  ingredients: FlowIngredient[];
  [key: string]: any;
};

export type IngredientUse = {
  day: number; // index into the week array (chronological)
  recipeName: string;
  ingredientIndex: number;
  qty: number;
  unit: string;
  source: FlowSource;
  buy: boolean; // shopping dimension: true → this use puts the item on the list
};

export type IngredientFlow = {
  key: string; // normalizeIngName(name)
  name: string; // first-seen display name
  uses: IngredientUse[]; // ordered by day, then position within the recipe
};

export type FlowGraph = Map<string, IngredientFlow>;

export type FlowViolation = {
  key: string;
  name: string;
  reusedDays: number[]; // days where the ingredient is marked "reused"
};

export type FlowPromotion = FlowViolation & {
  day: number; // day whose usage was promoted to buy (earliest)
  recipeName: string;
};

// Mirror the client's source coercion (generateRecipeFromPrompt / pushIngredient):
// anything that isn't explicitly "reused" or "staple" — including absent source on
// old recipes — counts as "buy".
function coerceSource(source: unknown): FlowSource {
  return source === "reused" ? "reused" : source === "staple" ? "staple" : "buy";
}

export function buildGraph(week: FlowRecipe[]): FlowGraph {
  const graph: FlowGraph = new Map();
  week.forEach((recipe, day) => {
    (recipe?.ingredients ?? []).forEach((ing, ingredientIndex) => {
      const name = String(ing?.name || "").trim();
      if (!name) return;
      const key = normalizeIngName(name);
      const source = coerceSource(ing.source);
      const use: IngredientUse = {
        day,
        recipeName: String(recipe?.name || ""),
        ingredientIndex,
        qty: Number(ing?.recipeAmount?.qty) || 0,
        unit: String(ing?.recipeAmount?.unit || "").trim(),
        source,
        buy: source === "buy",
      };
      const flow = graph.get(key);
      if (flow) flow.uses.push(use);
      else graph.set(key, { key, name, uses: [use] });
    });
  });
  return graph;
}

// Violations: ingredients marked "reused" somewhere with no supply source anywhere in
// the week (no "buy" use and no "staple" use — staples are covered by the pantry, and
// promoting them would spam the list with items the user already has).
export function validateWeek(week: FlowRecipe[]): FlowViolation[] {
  const violations: FlowViolation[] = [];
  for (const flow of buildGraph(week).values()) {
    const reusedDays = flow.uses.filter((u) => u.source === "reused").map((u) => u.day);
    if (!reusedDays.length) continue;
    if (flow.uses.some((u) => u.source === "buy" || u.source === "staple")) continue;
    violations.push({ key: flow.key, name: flow.name, reusedDays: Array.from(new Set(reusedDays)) });
  }
  return violations;
}

// Auto-repair: promote each violating ingredient to "buy" in its earliest-day usage so the
// list-builder picks it up. Only the shopping dimension flips; `preparedEarlier` (cook-mode
// dimension) is untouched. The input week is not mutated — repaired recipes/ingredients are
// shallow-copied along the modified path.
export function repairWeek(week: FlowRecipe[]): { week: FlowRecipe[]; promotions: FlowPromotion[] } {
  const violations = validateWeek(week);
  if (!violations.length) return { week, promotions: [] };

  const graph = buildGraph(week);
  const repaired = week.slice();
  const promotions: FlowPromotion[] = [];

  for (const v of violations) {
    const earliest = graph.get(v.key)!.uses[0];
    const recipe = repaired[earliest.day];
    const ingredients = recipe.ingredients.slice();
    const ing = { ...ingredients[earliest.ingredientIndex] };
    ing.source = "buy";
    ing.purchaseQty = Math.max(1, Math.ceil(Number(ing.purchaseQty) || 0));
    if (!String(ing.purchaseSize || "").trim()) {
      ing.purchaseSize = ing.recipeAmount?.unit
        ? `${ing.recipeAmount.qty} ${ing.recipeAmount.unit}`.trim()
        : String(ing.recipeAmount?.qty ?? 1);
    }
    ingredients[earliest.ingredientIndex] = ing;
    repaired[earliest.day] = { ...recipe, ingredients };
    promotions.push({ ...v, day: earliest.day, recipeName: earliest.recipeName });
  }

  return { week: repaired, promotions };
}

// TER-400 part 2 (stopgap for TER-317 serve-as-is): banked recipes are served verbatim from
// recipe_json, including provenance generated for their ORIGINAL week. Blank every
// week-specific claim before the recipe enters a new week:
//   - reuseNote / reuseNotes / provenance: prose referencing meals that don't exist here
//   - ingredient preparedEarlier: "prepped in an earlier meal this week" is false in the new week
// Kept: pantryNote (week-independent — lists the pantry staples this dish itself uses) and
// ingredient `source` flags — if a reused flag has no buy source in the NEW week, the
// validate→repair pass above promotes it. Recompute-instead-of-strip is construct mode (TER-303).
export function stripBankedProvenance<T extends FlowRecipe>(recipe: T): T {
  return {
    ...recipe,
    reuseNote: "",
    reuseNotes: [],
    provenance: "",
    ingredients: (recipe?.ingredients ?? []).map((i) => ({ ...i, preparedEarlier: false })),
  };
}
