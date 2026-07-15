import { describe, it, expect } from "vitest";
import { isExcludedFromWeeklyList, additionCategory } from "./shoppingExclusion";

describe("isExcludedFromWeeklyList", () => {
  it("excludes items in the durable alwaysHave list", () => {
    expect(isExcludedFromWeeklyList("Olive oil", ["olive oil"], [])).toBe(true);
  });

  it("excludes items in the per-week weekHaveIt override", () => {
    expect(isExcludedFromWeeklyList("Ground beef", [], ["ground beef"])).toBe(true);
  });

  it("keeps items in neither list", () => {
    expect(isExcludedFromWeeklyList("Apples", ["olive oil"], ["ground beef"])).toBe(false);
  });

  it("normalizes the name before matching (case + parenthetical strip)", () => {
    // normalizeIngName lowercases and strips trailing parentheticals
    expect(isExcludedFromWeeklyList("Bananas (organic)", [], ["bananas"])).toBe(true);
    expect(isExcludedFromWeeklyList("BANANAS", [], ["bananas"])).toBe(true);
  });

  it("treats alwaysHave and weekHaveIt as independent sources", () => {
    // an item only in weekHaveIt is still excluded even with an empty alwaysHave
    expect(isExcludedFromWeeklyList("milk", [], ["milk"])).toBe(true);
    // and vice versa
    expect(isExcludedFromWeeklyList("milk", ["milk"], [])).toBe(true);
  });
});

describe("additionCategory", () => {
  it("keeps a valid known category", () => {
    expect(additionCategory("Produce")).toBe("Produce");
    expect(additionCategory("Meat & Seafood")).toBe("Meat & Seafood");
  });

  it("defaults a missing category (legacy addition) to Other", () => {
    expect(additionCategory(undefined)).toBe("Other");
    expect(additionCategory(null)).toBe("Other");
  });

  it("defaults an unknown/invalid category to Other", () => {
    expect(additionCategory("Snacks")).toBe("Other");
    expect(additionCategory("")).toBe("Other");
    expect(additionCategory(42)).toBe("Other");
  });
});
