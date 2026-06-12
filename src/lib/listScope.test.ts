import { describe, it, expect } from "vitest";
import { listScope } from "./listScope";

const day = (id: string, overrides: Record<string, any> = {}) => ({ id, skip: false, ...overrides });
const accepted = (name: string, overrides: Record<string, any> = {}) => ({
  status: "accepted", data: { name, ingredients: [] }, error: null, kcalInfo: null, ...overrides,
});

const TODAY = "2026-06-12";

describe("listScope", () => {
  it("includes only accepted meals", () => {
    const days = [day("a"), day("b"), day("c"), day("d")];
    const meals = {
      a: accepted("Tacos"),
      b: { status: "ready", data: { name: "Soup" } },
      c: { status: "loading", data: null },
      // d has no meal at all
    };
    const scope = listScope(days, meals, TODAY, TODAY);
    expect(scope.map((e) => e.meal.data.name)).toEqual(["Tacos"]);
  });

  it("excludes skipped days even if a meal entry lingers", () => {
    const days = [day("a", { skip: true }), day("b")];
    const meals = { a: accepted("Tacos"), b: accepted("Soup") };
    const scope = listScope(days, meals, TODAY, TODAY);
    expect(scope.map((e) => e.dayId)).toEqual(["b"]);
  });

  it("excludes past dates, includes today and forward (ISO string compare)", () => {
    // window starts two days before today: positions 0,1 are past; 2 is today
    const days = [day("a"), day("b"), day("c"), day("d")];
    const meals = { a: accepted("Mon"), b: accepted("Tue"), c: accepted("Wed"), d: accepted("Thu") };
    const scope = listScope(days, meals, "2026-06-10", TODAY);
    expect(scope.map((e) => e.date)).toEqual(["2026-06-12", "2026-06-13"]);
    expect(scope.map((e) => e.meal.data.name)).toEqual(["Wed", "Thu"]);
  });

  it("excludes meals stamped orderedAt", () => {
    const days = [day("a"), day("b")];
    const meals = {
      a: accepted("Tacos", { orderedAt: "2026-06-12T18:00:00.000Z" }),
      b: accepted("Soup"),
    };
    const scope = listScope(days, meals, TODAY, TODAY);
    expect(scope.map((e) => e.dayId)).toEqual(["b"]);
  });

  it("reject-then-regenerate on a stamped date re-enters the list", () => {
    const days = [day("a")];
    const stamped = { a: accepted("Tacos", { orderedAt: "2026-06-12T18:00:00.000Z" }) };
    expect(listScope(days, stamped, TODAY, TODAY)).toEqual([]);
    // rejecting replaces the entry; the regenerated accepted meal has no stamp
    const regenerated = { a: accepted("Enchiladas") };
    const scope = listScope(days, regenerated, TODAY, TODAY);
    expect(scope.map((e) => e.meal.data.name)).toEqual(["Enchiladas"]);
  });

  it("includes legacy meals with no orderedAt field", () => {
    const days = [day("a")];
    const legacy = { a: { status: "accepted", data: { name: "Old", ingredients: [] } } };
    expect(listScope(days, legacy, TODAY, TODAY)).toHaveLength(1);
  });

  it("maps window positions to dates from startDate", () => {
    const days = [day("a"), day("b")];
    const meals = { a: accepted("Tacos"), b: accepted("Soup") };
    const scope = listScope(days, meals, "2026-06-15", TODAY);
    expect(scope.map((e) => e.date)).toEqual(["2026-06-15", "2026-06-16"]);
  });

  it("is empty for a missing startDate or non-array days", () => {
    expect(listScope([day("a")], { a: accepted("Tacos") }, "", TODAY)).toEqual([]);
    expect(listScope(undefined as any, {}, TODAY, TODAY)).toEqual([]);
  });
});
