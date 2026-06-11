import { describe, it, expect } from "vitest";
import { checkRecipe, expandAvoidTerm, avoidPromptBlock, mergeTerms } from "./avoidGuard";
import type { RecipeLike } from "./avoidGuard";

const recipe = (over: Partial<RecipeLike> = {}): RecipeLike => ({
  name: "Lemon Herb Chicken with Rice",
  ingredients: [{ name: "chicken breast" }, { name: "white rice" }, { name: "lemon" }],
  steps: ["Season the chicken.", "Cook the rice.", "Serve together."],
  ...over,
});

describe("checkRecipe — direct term hits", () => {
  it("flags a direct ingredient match", () => {
    const hits = checkRecipe(recipe({ ingredients: [{ name: "pork shoulder" }] }), ["pork"]);
    expect(hits).toEqual([{ term: "pork", matchedText: "pork", where: "ingredient" }]);
  });

  it("is case-insensitive and tolerates plural terms", () => {
    const hits = checkRecipe(recipe({ ingredients: [{ name: "Roasted Peanuts" }] }), ["Peanuts"]);
    expect(hits.length).toBe(1);
    expect(hits[0].where).toBe("ingredient");
  });
});

describe("checkRecipe — derived/hidden form hits (expansion table)", () => {
  it("chorizo trips a pork restriction (the audit's exact miss)", () => {
    const hits = checkRecipe(
      recipe({ name: "Smoky Black Bean Tacos", ingredients: [{ name: "chorizo" }] }),
      ["pork"],
    );
    expect(hits).toContainEqual({ term: "pork", matchedText: "chorizo", where: "ingredient" });
  });

  it("peanut oil trips a peanut restriction", () => {
    const hits = checkRecipe(recipe({ ingredients: [{ name: "peanut oil" }] }), ["peanut"]);
    expect(hits.length).toBe(1);
    expect(hits[0].term).toBe("peanut");
  });

  it("cashews trip a tree-nut restriction via the 'nuts' alias", () => {
    const hits = checkRecipe(recipe({ ingredients: [{ name: "cashews" }] }), ["nuts"]);
    expect(hits.length).toBe(1);
  });

  it("cheese trips a dairy restriction via the milk alias", () => {
    const hits = checkRecipe(recipe({ ingredients: [{ name: "shredded cheddar cheese" }] }), ["dairy"]);
    expect(hits.length).toBe(1);
  });
});

describe("checkRecipe — word-boundary non-hits", () => {
  it("pineapple does not trip a tree-nut restriction (pine nut logic)", () => {
    expect(checkRecipe(recipe({ ingredients: [{ name: "pineapple chunks" }] }), ["nuts"])).toEqual([]);
  });

  it("plain butter does not trip a peanut restriction (peanut butter reverse)", () => {
    expect(checkRecipe(recipe({ ingredients: [{ name: "butter" }] }), ["peanut"])).toEqual([]);
  });

  it("nutmeg does not trip a tree-nut restriction", () => {
    expect(checkRecipe(recipe({ ingredients: [{ name: "ground nutmeg" }] }), ["nuts"])).toEqual([]);
  });
});

describe("checkRecipe — scans dish name and steps, not just ingredients", () => {
  it("flags a violation in the dish name", () => {
    const hits = checkRecipe(recipe({ name: "Bacon-Wrapped Chicken" }), ["pork"]);
    expect(hits).toContainEqual({ term: "pork", matchedText: "bacon", where: "name" });
  });

  it("flags a violation hiding in a step (including parentheticals)", () => {
    const hits = checkRecipe(
      recipe({ steps: ["Sear the chicken (in lard) until golden."] }),
      ["pork"],
    );
    expect(hits).toContainEqual({ term: "pork", matchedText: "lard", where: "step" });
  });
});

describe("checkRecipe — clean recipe and edge cases", () => {
  it("passes a clean recipe", () => {
    expect(checkRecipe(recipe(), ["pork", "peanuts", "shellfish"])).toEqual([]);
  });

  it("returns no hits with an empty avoid list", () => {
    expect(checkRecipe(recipe({ ingredients: [{ name: "bacon" }] }), [])).toEqual([]);
  });

  it("tolerates missing fields", () => {
    expect(checkRecipe({} as RecipeLike, ["pork"])).toEqual([]);
  });

  it("reports both terms when both are violated", () => {
    const hits = checkRecipe(
      recipe({ ingredients: [{ name: "ham" }, { name: "satay sauce" }] }),
      ["pork", "peanut"],
    );
    expect(new Set(hits.map((h) => h.term))).toEqual(new Set(["pork", "peanut"]));
  });
});

describe("expandAvoidTerm", () => {
  it("always includes the term itself", () => {
    expect(expandAvoidTerm("dragonfruit")).toEqual(["dragonfruit"]);
  });

  it("includes documented derived forms", () => {
    const forms = expandAvoidTerm("pork");
    for (const f of ["bacon", "ham", "chorizo", "prosciutto", "pancetta", "sausage", "lard"]) {
      expect(forms).toContain(f);
    }
  });
});

describe("avoidPromptBlock — every generation prompt provably includes the terms", () => {
  it("names every structured term and every note term", () => {
    const block = avoidPromptBlock(["pork"], ["peanuts"]);
    expect(block).toMatch(/\bpork\b/);
    expect(block).toMatch(/\bpeanuts\b/);
    expect(block).toContain("STRICT AVOID LIST");
  });

  it("emphasizes violated terms on retry", () => {
    const block = avoidPromptBlock(["pork"], [], ["pork"]);
    expect(block).toContain("VIOLATED");
  });

  it("returns empty string when there is nothing to avoid", () => {
    expect(avoidPromptBlock([], [])).toBe("");
  });

  it("dedupes terms present in both the structured list and the note", () => {
    const block = avoidPromptBlock(["peanuts"], ["peanuts"]);
    expect(block.match(/peanuts \(including/g)?.length).toBe(1);
  });
});

describe("mergeTerms", () => {
  it("normalizes, dedupes, and preserves order", () => {
    expect(mergeTerms(["Pork ", "peanuts"], ["pork", "Shellfish"])).toEqual([
      "pork", "peanuts", "shellfish",
    ]);
  });
});
