import { describe, it, expect } from "vitest";
import { listScope, listScopeFromModel, reuseScopeFromModel } from "./listScope";
import { emptyDateModel, mergeWindowIntoDateModel, type DayConfig } from "@terenc/shared/dateModel";

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

/* TER-426 — the model-based form: full forward range, not window-bounded. */
describe("listScopeFromModel", () => {
  const fullDay = (id: string, overrides: Record<string, any> = {}): DayConfig => ({
    id, people: 4, cuisine: "Any", temp: "Auto", effort: "any", note: "", pinnedRecipe: undefined, skip: false, ...overrides,
  });
  const model = (mealsByDate: Record<string, any>, dayConfigByDate: Record<string, any> = {}) =>
    ({ mealsByDate, dayConfigByDate });

  it("includes only accepted meals dated today or later, sorted by date", () => {
    const m = model({
      "2026-06-10": accepted("Past"),
      "2026-06-14": accepted("Sun"),
      "2026-06-12": accepted("Fri"),
      "2026-06-13": { status: "ready", data: { name: "Pending" } },
    });
    const scope = listScopeFromModel(m, TODAY);
    expect(scope.map((e) => e.date)).toEqual(["2026-06-12", "2026-06-14"]);
    expect(scope.map((e) => e.meal.data.name)).toEqual(["Fri", "Sun"]);
  });

  it("excludes meals stamped orderedAt; legacy meals with no stamp field are included", () => {
    const m = model({
      "2026-06-12": accepted("Stamped", { orderedAt: "2026-06-12T18:00:00.000Z" }),
      "2026-06-13": { status: "accepted", data: { name: "Legacy", ingredients: [] } },
    });
    expect(listScopeFromModel(m, TODAY).map((e) => e.meal.data.name)).toEqual(["Legacy"]);
  });

  it("excludes dates skip-flagged in dayConfigByDate and carries the config id as dayId", () => {
    const m = model(
      { "2026-06-12": accepted("Tacos"), "2026-06-13": accepted("Soup") },
      { "2026-06-12": fullDay("a", { skip: true }), "2026-06-13": fullDay("b") },
    );
    const scope = listScopeFromModel(m, TODAY);
    expect(scope.map((e) => e.dayId)).toEqual(["b"]);
  });

  // The Phase B acceptance case: plan this week, move the window forward and plan
  // next week, move it back — BOTH weeks' unshopped forward meals are in scope.
  it("spans every planned week at once, not just the current window", () => {
    const week1Days = [fullDay("a"), fullDay("b")];
    const week1Meals = { a: accepted("Tacos"), b: accepted("Soup") };
    let m = mergeWindowIntoDateModel(emptyDateModel(), week1Days, week1Meals, "2026-06-12");
    // window moves +7 and next week gets planned
    const week2Days = [fullDay("x"), fullDay("y")];
    const week2Meals = { x: accepted("Curry"), y: accepted("Chili") };
    m = mergeWindowIntoDateModel(m, week2Days, week2Meals, "2026-06-19");
    const scope = listScopeFromModel(m, TODAY);
    expect(scope.map((e) => e.date)).toEqual(["2026-06-12", "2026-06-13", "2026-06-19", "2026-06-20"]);
    expect(scope.map((e) => e.meal.data.name)).toEqual(["Tacos", "Soup", "Curry", "Chili"]);

    // stamping week 1 leaves week 2 in scope (and vice versa)
    m = {
      ...m,
      mealsByDate: {
        ...m.mealsByDate,
        "2026-06-12": { ...m.mealsByDate["2026-06-12"], orderedAt: "2026-06-12T18:00:00.000Z" },
        "2026-06-13": { ...m.mealsByDate["2026-06-13"], orderedAt: "2026-06-12T18:00:00.000Z" },
      },
    };
    expect(listScopeFromModel(m, TODAY).map((e) => e.meal.data.name)).toEqual(["Curry", "Chili"]);
  });

  it("is empty for an empty model", () => {
    expect(listScopeFromModel(emptyDateModel(), TODAY)).toEqual([]);
  });
});

/* TER-428 — the generation reuse context: list scope + ready proposals. */
describe("reuseScopeFromModel", () => {
  const fullDay = (id: string, overrides: Record<string, any> = {}): DayConfig => ({
    id, people: 4, cuisine: "Any", temp: "Auto", effort: "any", note: "", pinnedRecipe: undefined, skip: false, ...overrides,
  });
  const model = (mealsByDate: Record<string, any>, dayConfigByDate: Record<string, any> = {}) =>
    ({ mealsByDate, dayConfigByDate });

  it("includes accepted AND ready meals; excludes loading/error/dataless entries", () => {
    const m = model({
      "2026-06-12": accepted("Tacos"),
      "2026-06-13": { status: "ready", data: { name: "Soup" } },
      "2026-06-14": { status: "loading", data: null },
      "2026-06-15": { status: "error", data: null, error: "boom" },
      "2026-06-16": { status: "accepted", data: null }, // corrupt entry: nothing to coordinate with
    });
    expect(reuseScopeFromModel(m, TODAY).map((d) => d.name)).toEqual(["Tacos", "Soup"]);
  });

  it("excludes ordered/past/skipped meals — the trip-sharing filters", () => {
    const m = model(
      {
        "2026-06-10": accepted("Past"),
        "2026-06-12": accepted("Stamped", { orderedAt: "2026-06-11T18:00:00.000Z" }),
        "2026-06-13": accepted("Skipped"),
        "2026-06-14": accepted("Keeper"),
      },
      { "2026-06-13": fullDay("s", { skip: true }) },
    );
    expect(reuseScopeFromModel(m, TODAY).map((d) => d.name)).toEqual(["Keeper"]);
  });

  it("excludes the day being regenerated via excludeDate", () => {
    const m = model({ "2026-06-12": accepted("Tacos"), "2026-06-13": accepted("Soup") });
    expect(reuseScopeFromModel(m, TODAY, "2026-06-12").map((d) => d.name)).toEqual(["Soup"]);
  });

  // The PR #101 review §1 case (DoD 4): after week 1 is marked ordered, a meal
  // generated for week 2 must only see week 2 — its provenance can't cite
  // ingredients that already left with the stamped trip.
  it("after an order, only unshopped meals remain in the context", () => {
    let m = mergeWindowIntoDateModel(
      emptyDateModel(),
      [fullDay("a"), fullDay("b")],
      { a: accepted("Tacos"), b: accepted("Soup") },
      "2026-06-12",
    );
    m = mergeWindowIntoDateModel(
      m,
      [fullDay("x")],
      { x: accepted("Curry") },
      "2026-06-19",
    );
    // both weeks unshopped: a week-2 generation coordinates with everything
    expect(reuseScopeFromModel(m, TODAY, "2026-06-20").map((d) => d.name)).toEqual(["Tacos", "Soup", "Curry"]);
    // mark week 1 ordered
    const orderedAt = "2026-06-12T18:00:00.000Z";
    m = {
      ...m,
      mealsByDate: {
        ...m.mealsByDate,
        "2026-06-12": { ...m.mealsByDate["2026-06-12"], orderedAt },
        "2026-06-13": { ...m.mealsByDate["2026-06-13"], orderedAt },
      },
    };
    expect(reuseScopeFromModel(m, TODAY, "2026-06-20").map((d) => d.name)).toEqual(["Curry"]);
  });
});
