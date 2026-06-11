import { describe, it, expect } from "vitest";
import { buildGraph, validateWeek, repairWeek, stripBankedProvenance } from "./ingredientFlow";
import type { FlowRecipe } from "./ingredientFlow";
import { buildInstacartHandoff } from "./instacart-handoff";
import { normalizeIngName } from "./normalize";

function ing(name: string, source: "buy" | "reused" | "staple", overrides: Record<string, any> = {}) {
  return {
    name,
    recipeAmount: { qty: 1, unit: "lb" },
    source,
    preparedEarlier: false,
    purchaseSize: source === "buy" ? "1 lb pack" : "",
    purchaseQty: source === "buy" ? 1 : 0,
    category: "Other",
    ...overrides,
  };
}

function recipe(name: string, ingredients: any[]): FlowRecipe {
  return { name, ingredients };
}

describe("buildGraph", () => {
  it("keys flows by normalizeIngName and orders uses by day", () => {
    const week = [
      recipe("Tacos", [ing("Chicken Breast (boneless)", "buy")]),
      recipe("Wraps", [ing("chicken breast", "reused")]),
    ];
    const graph = buildGraph(week);
    const flow = graph.get("chicken breast");
    expect(flow).toBeDefined();
    expect(flow!.uses.map((u) => u.day)).toEqual([0, 1]);
    expect(flow!.uses.map((u) => u.buy)).toEqual([true, false]);
  });

  it("treats absent source (old recipes) as buy", () => {
    const graph = buildGraph([recipe("Old", [{ name: "Rice", recipeAmount: { qty: 1, unit: "cup" } }])]);
    expect(graph.get("rice")!.uses[0].source).toBe("buy");
  });
});

describe("validateWeek", () => {
  it("passes a clean week (buy then reuse)", () => {
    const week = [
      recipe("Roast Chicken", [ing("Chicken Breast", "buy"), ing("Olive Oil", "staple")]),
      recipe("Chicken Wraps", [ing("Chicken Breast", "reused", { preparedEarlier: true })]),
    ];
    expect(validateWeek(week)).toEqual([]);
  });

  it("flags a reuse-only ingredient (audit C-1: shredded chicken never bought)", () => {
    const week = [
      recipe("Veggie Pasta", [ing("Penne", "buy")]),
      recipe("Shredded Chicken BLT Wraps", [ing("Shredded Chicken", "reused", { preparedEarlier: true })]),
      recipe("Lentil Soup", [ing("Lentils", "buy")]),
      recipe("Sesame-Ginger Chicken Fried Rice", [ing("Shredded Chicken", "reused", { preparedEarlier: true })]),
    ];
    const violations = validateWeek(week);
    expect(violations).toHaveLength(1);
    expect(violations[0].key).toBe("shredded chicken");
    expect(violations[0].reusedDays).toEqual([1, 3]);
  });

  it("accepts a staple claim elsewhere as a supply source", () => {
    const week = [
      recipe("Soup", [ing("Chicken Broth", "staple")]),
      recipe("Risotto", [ing("Chicken Broth", "reused")]),
    ];
    expect(validateWeek(week)).toEqual([]);
  });

  it("converges name variants via normalizeIngName (case/whitespace/parentheticals)", () => {
    const week = [
      recipe("Roast", [ing("Chicken Breast (boneless, skinless)", "buy")]),
      recipe("Wraps", [ing("  chicken   breast ", "reused")]),
    ];
    expect(validateWeek(week)).toEqual([]);
  });

  it("does NOT converge genuinely different names — 'shredded chicken' vs 'chicken breast' stay distinct per existing normalizer", () => {
    const week = [
      recipe("Roast", [ing("Chicken Breast", "buy")]),
      recipe("Wraps", [ing("Shredded Chicken", "reused")]),
    ];
    const violations = validateWeek(week);
    expect(violations).toHaveLength(1);
    expect(violations[0].key).toBe("shredded chicken");
  });
});

describe("repairWeek", () => {
  it("promotes the earliest-day usage to buy and reports it", () => {
    const week = [
      recipe("Veggie Pasta", [ing("Penne", "buy")]),
      recipe("BLT Wraps", [ing("Shredded Chicken", "reused", { preparedEarlier: true })]),
      recipe("Fried Rice", [ing("Shredded Chicken", "reused", { preparedEarlier: true })]),
    ];
    const { week: repaired, promotions } = repairWeek(week);

    expect(promotions).toHaveLength(1);
    expect(promotions[0]).toMatchObject({ key: "shredded chicken", day: 1, recipeName: "BLT Wraps", reusedDays: [1, 2] });

    const promoted = repaired[1].ingredients[0];
    expect(promoted.source).toBe("buy");
    expect(promoted.purchaseQty).toBeGreaterThanOrEqual(1);
    expect(promoted.purchaseSize).toBe("1 lb");
    // Cook-mode dimension untouched.
    expect(promoted.preparedEarlier).toBe(true);
    // Later usage stays reused.
    expect(repaired[2].ingredients[0].source).toBe("reused");
    // Repair is validated: the repaired week is clean.
    expect(validateWeek(repaired)).toEqual([]);
  });

  it("does not mutate the input week", () => {
    const week = [recipe("Wraps", [ing("Shredded Chicken", "reused")])];
    const snapshot = JSON.parse(JSON.stringify(week));
    repairWeek(week);
    expect(week).toEqual(snapshot);
  });

  it("returns the same week reference when there is nothing to repair", () => {
    const week = [recipe("Pasta", [ing("Penne", "buy")])];
    const { week: repaired, promotions } = repairWeek(week);
    expect(repaired).toBe(week);
    expect(promotions).toEqual([]);
  });
});

// Audit finding C-1 repro (Chicago 3-person baseline week): shredded chicken reused on
// days 3 and 5, never bought → without repair, the list and the Instacart handoff contain
// no chicken meat. Mirrors the App.tsx wiring: repairWeek → buy-only aggregation → handoff.
describe("audit C-1 end-to-end repro", () => {
  const week = [
    recipe("Veggie Pasta", [ing("Penne", "buy"), ing("Marinara Sauce", "buy")]),
    recipe("Beef Tacos", [ing("Ground Beef", "buy")]),
    recipe("Shredded Chicken BLT Wraps", [
      ing("Shredded Chicken", "reused", { preparedEarlier: true }),
      ing("Bacon", "buy"),
    ]),
    recipe("Lentil Soup", [ing("Lentils", "buy"), ing("Chicken Broth", "buy")]),
    recipe("Sesame-Ginger Chicken Fried Rice", [
      ing("Shredded Chicken", "reused", { preparedEarlier: true }),
      ing("Rice", "buy"),
    ]),
  ];

  function aggregateBuyItems(recipes: FlowRecipe[]) {
    // Same filter as App.tsx pushIngredient: only source:"buy" reaches the list.
    const byCat: Record<string, Array<{ name: string; qty: number; unit: string }>> = { Other: [] };
    for (const r of recipes) for (const i of r.ingredients) {
      if (i.source === "reused" || i.source === "staple") continue;
      byCat.Other.push({ name: i.name, qty: i.purchaseQty ?? 1, unit: i.purchaseSize ?? "" });
    }
    return byCat;
  }

  it("without repair, chicken is missing from list and handoff (the bug)", () => {
    const names = aggregateBuyItems(week).Other.map((i) => normalizeIngName(i.name));
    expect(names).not.toContain("shredded chicken");
  });

  it("with repair, chicken surfaces on the list AND in the Instacart handoff", () => {
    const { week: repaired, promotions } = repairWeek(week);
    expect(promotions.map((p) => p.key)).toEqual(["shredded chicken"]);

    const list = aggregateBuyItems(repaired);
    expect(list.Other.map((i) => normalizeIngName(i.name))).toContain("shredded chicken");

    const handoff = buildInstacartHandoff(list);
    expect(handoff.lines.join("\n").toLowerCase()).toContain("shredded chicken");
    expect(handoff.lineItems.some((li) => li.name.toLowerCase().includes("shredded chicken"))).toBe(true);
  });
});

describe("stripBankedProvenance", () => {
  it("blanks week-specific provenance, resets preparedEarlier, keeps pantryNote and source flags", () => {
    const banked = {
      name: "Sesame-Ginger Chicken Fried Rice",
      reuseNote: "Chicken poached earlier this week.",
      reuseNotes: ["Shredded chicken: poached & shredded earlier from the breast pack."],
      provenance: "The chicken is already cooked — you made it Saturday.",
      pantryNote: "Soy sauce, sesame oil, garlic powder",
      ingredients: [
        ing("Shredded Chicken", "reused", { preparedEarlier: true }),
        ing("Rice", "buy"),
      ],
    };
    const served = stripBankedProvenance(banked);

    expect(served.reuseNote).toBe("");
    expect(served.reuseNotes).toEqual([]);
    expect(served.provenance).toBe("");
    expect(served.pantryNote).toBe("Soy sauce, sesame oil, garlic powder");
    expect(served.ingredients.map((i: any) => i.preparedEarlier)).toEqual([false, false]);
    // Shopping dimension left for the week-level validate→repair pass.
    expect(served.ingredients[0].source).toBe("reused");
    // Input not mutated.
    expect(banked.ingredients[0].preparedEarlier).toBe(true);
    expect(banked.reuseNotes).toHaveLength(1);
  });
});
