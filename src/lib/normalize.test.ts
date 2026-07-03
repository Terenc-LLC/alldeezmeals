import { describe, it, expect } from "vitest";
import { normalizeIngName, mergePantryIntoAlwaysHave } from "./normalize";

describe("normalizeIngName", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeIngName("  Olive  Oil  ")).toBe("olive oil");
  });

  it("strips parentheticals", () => {
    expect(normalizeIngName("Garlic (organic)")).toBe("garlic");
    expect(normalizeIngName("Onion (yellow), diced")).toBe("onion , diced");
  });

  it("folds hyphens to spaces (TER-522)", () => {
    expect(normalizeIngName("long-grain white rice")).toBe("long grain white rice");
    expect(normalizeIngName("extra-virgin olive oil")).toBe("extra virgin olive oil");
  });

  it("collapses hyphen and space spellings to the same key", () => {
    expect(normalizeIngName("long-grain white rice")).toBe(
      normalizeIngName("long grain white rice"),
    );
  });

  it("does NOT reorder tokens — word-order variants stay distinct (out of scope)", () => {
    expect(normalizeIngName("white long-grain rice")).not.toBe(
      normalizeIngName("long-grain white rice"),
    );
  });

  it("does not leave double spaces after folding a hyphen next to a space", () => {
    expect(normalizeIngName("sun- dried tomato")).toBe("sun dried tomato");
  });
});

describe("mergePantryIntoAlwaysHave", () => {
  it("unions pantry and alwaysHave, normalizing and deduping (TER-330)", () => {
    const merged = mergePantryIntoAlwaysHave(
      ["Olive Oil", "Garlic (organic)", "salt"],
      ["garlic", "pepper"],
    );
    expect(merged.sort()).toEqual(["garlic", "olive oil", "pepper", "salt"].sort());
  });

  it("re-normalizes existing alwaysHave keys so pre-fold hyphen variants collapse (TER-522)", () => {
    const merged = mergePantryIntoAlwaysHave(null, [
      "long-grain white rice",
      "long grain white rice",
      "extra-virgin olive oil",
    ]);
    expect(merged.sort()).toEqual(
      ["long grain white rice", "extra virgin olive oil"].sort(),
    );
  });

  it("is lossless — distinct keys are preserved", () => {
    const merged = mergePantryIntoAlwaysHave(
      ["cumin"],
      ["long-grain white rice", "basmati rice"],
    );
    expect(merged.sort()).toEqual(
      ["long grain white rice", "basmati rice", "cumin"].sort(),
    );
  });

  it("dedupes a hyphenated alwaysHave key against a spaced pantry key", () => {
    const merged = mergePantryIntoAlwaysHave(
      ["long grain white rice"],
      ["long-grain white rice"],
    );
    expect(merged).toEqual(["long grain white rice"]);
  });

  it("handles null/undefined inputs and skips empty keys", () => {
    expect(mergePantryIntoAlwaysHave(null, null)).toEqual([]);
    expect(mergePantryIntoAlwaysHave([""], ["  "])).toEqual([]);
  });
});

// Mirrors the App.tsx exclusion check `alwaysHave.includes(normalizeIngName(name))`
// used to drop always-have items from the buy list.
describe("alwaysHave exclusion via normalizeIngName", () => {
  const isExcluded = (alwaysHave: string[], itemName: string) =>
    alwaysHave.includes(normalizeIngName(itemName));

  it("a hyphen-spelled item now matches a space-spelled alwaysHave key (TER-522)", () => {
    const alwaysHave = mergePantryIntoAlwaysHave(null, ["long grain white rice"]);
    // Before the hyphen fold this would NOT have matched; now it does.
    expect(isExcluded(alwaysHave, "Long-Grain White Rice")).toBe(true);
  });

  it("still excludes an exactly-matching item", () => {
    const alwaysHave = mergePantryIntoAlwaysHave(null, ["olive oil"]);
    expect(isExcluded(alwaysHave, "Olive Oil")).toBe(true);
  });

  it("does not exclude an unrelated item", () => {
    const alwaysHave = mergePantryIntoAlwaysHave(null, ["long grain white rice"]);
    expect(isExcluded(alwaysHave, "ground beef")).toBe(false);
  });
});
