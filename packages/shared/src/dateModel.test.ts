import { describe, it, expect } from "vitest";
import { emptyDateModel, mergeWindowIntoDateModel, hydrateWindow, migrateLegacyBlob, type DayConfig } from "./dateModel";

const day = (id: string, overrides: Record<string, any> = {}): DayConfig => ({
  id, people: 4, cuisine: "Any", temp: "Auto", effort: "any", note: "", pinnedRecipe: undefined, skip: false, ...overrides,
});
const accepted = (name: string) => ({ status: "accepted", data: { name, ingredients: [] }, error: null, kcalInfo: null });

let seq = 0;
const makeFreshDay = () => day(`fresh-${++seq}`);

describe("mergeWindowIntoDateModel", () => {
  it("maps window positions to dates and writes configs + meals", () => {
    const days = [day("a"), day("b")];
    const model = mergeWindowIntoDateModel(emptyDateModel(), days, { a: accepted("Tacos") }, "2026-06-15");
    expect(model.dayConfigByDate["2026-06-15"].id).toBe("a");
    expect(model.dayConfigByDate["2026-06-16"].id).toBe("b");
    expect(model.mealsByDate["2026-06-15"].data.name).toBe("Tacos");
    expect(model.mealsByDate["2026-06-16"]).toBeUndefined();
  });

  it("never deletes out-of-window dates", () => {
    let model = mergeWindowIntoDateModel(emptyDateModel(), [day("a")], { a: accepted("Tacos") }, "2026-06-15");
    // window moves a week forward; the old date's meal and config must survive
    model = mergeWindowIntoDateModel(model, [day("z")], { z: accepted("Soup") }, "2026-06-22");
    expect(model.mealsByDate["2026-06-15"].data.name).toBe("Tacos");
    expect(model.dayConfigByDate["2026-06-15"].id).toBe("a");
    expect(model.mealsByDate["2026-06-22"].data.name).toBe("Soup");
  });

  it("a rejected/emptied meal inside the window clears that date", () => {
    const days = [day("a"), day("b")];
    let model = mergeWindowIntoDateModel(emptyDateModel(), days, { a: accepted("Tacos"), b: accepted("Soup") }, "2026-06-15");
    model = mergeWindowIntoDateModel(model, days, { b: accepted("Soup") }, "2026-06-15"); // "a" rejected
    expect(model.mealsByDate["2026-06-15"]).toBeUndefined();
    expect(model.mealsByDate["2026-06-16"].data.name).toBe("Soup");
    expect(model.dayConfigByDate["2026-06-15"].id).toBe("a"); // config stays
  });

  it("returns prev by reference when nothing changed", () => {
    const days = [day("a")];
    const meals = { a: accepted("Tacos") };
    const model = mergeWindowIntoDateModel(emptyDateModel(), days, meals, "2026-06-15");
    expect(mergeWindowIntoDateModel(model, days, meals, "2026-06-15")).toBe(model);
  });

  // TER-426: this identity is load-bearing — App's liveModel memo re-merges the
  // window on every render and setDateModel(liveModel) relies on getting the same
  // reference back to bail out of the state→merge→state cycle. Must hold even
  // when the model carries dates outside the current window.
  it("reference bailout holds with out-of-window dates in the model (liveModel loop safety)", () => {
    const week1Days = [day("a")];
    const week1Meals = { a: accepted("Tacos") };
    let model = mergeWindowIntoDateModel(emptyDateModel(), week1Days, week1Meals, "2026-06-15");
    const week2Days = [day("z")];
    const week2Meals = { z: accepted("Soup") };
    model = mergeWindowIntoDateModel(model, week2Days, week2Meals, "2026-06-22");
    expect(mergeWindowIntoDateModel(model, week2Days, week2Meals, "2026-06-22")).toBe(model);
    expect(model.mealsByDate["2026-06-15"].data.name).toBe("Tacos"); // week 1 untouched
  });

  it("is a no-op for an empty window or missing startDate", () => {
    const model = emptyDateModel();
    expect(mergeWindowIntoDateModel(model, [], {}, "2026-06-15")).toBe(model);
    expect(mergeWindowIntoDateModel(model, [day("a")], {}, "")).toBe(model);
  });
});

describe("hydrateWindow", () => {
  it("merge then hydrate is identity for the window", () => {
    const days = [day("a"), day("b", { skip: true }), day("c", { people: 2, cuisine: "Thai" })];
    const meals = { a: accepted("Tacos"), c: accepted("Curry") };
    const model = mergeWindowIntoDateModel(emptyDateModel(), days, meals, "2026-06-15");
    const out = hydrateWindow(model.mealsByDate, model.dayConfigByDate, "2026-06-15", 3, makeFreshDay);
    expect(out.days).toEqual(days);
    expect(out.meals).toEqual(meals);
  });

  it("synthesizes fresh configs only for dates that have none, preserving stored ids", () => {
    const model = mergeWindowIntoDateModel(emptyDateModel(), [day("a")], {}, "2026-06-15");
    const out = hydrateWindow(model.mealsByDate, model.dayConfigByDate, "2026-06-15", 3, makeFreshDay);
    expect(out.days[0].id).toBe("a");
    expect(out.days[1].id).toMatch(/^fresh-/);
    expect(out.days[2].id).toMatch(/^fresh-/);
    expect(out.days[1].id).not.toBe(out.days[2].id);
  });

  it("window move re-hydration returns the right meals for the new dates", () => {
    const days = [day("a"), day("b")];
    const meals = { a: accepted("Tacos"), b: accepted("Soup") };
    let model = mergeWindowIntoDateModel(emptyDateModel(), days, meals, "2026-06-15");

    // move +7: planned dates fall out of the window — meals invisible but preserved
    const ahead = hydrateWindow(model.mealsByDate, model.dayConfigByDate, "2026-06-22", 2, makeFreshDay);
    expect(ahead.meals).toEqual({});
    expect(model.mealsByDate["2026-06-15"].data.name).toBe("Tacos");

    // merge the (empty) new window, then move back: the same accepted meals reappear on their dates
    model = mergeWindowIntoDateModel(model, ahead.days, ahead.meals, "2026-06-22");
    const back = hydrateWindow(model.mealsByDate, model.dayConfigByDate, "2026-06-15", 2, makeFreshDay);
    expect(back.days.map((d) => d.id)).toEqual(["a", "b"]);
    expect(back.meals.a.data.name).toBe("Tacos");
    expect(back.meals.b.data.name).toBe("Soup");
  });

  // TER-428 (decision locked): a pin belongs to its date — no automatic
  // carry-forward. Window away and back must restore the pin on its original
  // date, config and materialized meal intact, ordered stamp included.
  it("a pinned meal survives a window move away and back, on its date, stamp intact", () => {
    const recipe = { name: "Friday Pizza", ingredients: [] };
    const pinnedDay = day("p", { pinnedRecipe: recipe });
    const pinnedMeal = { status: "accepted", data: recipe, error: null, kcalInfo: null, pinned: true, orderedAt: "2026-06-14T18:00:00.000Z" };
    let model = mergeWindowIntoDateModel(emptyDateModel(), [pinnedDay], { p: pinnedMeal }, "2026-06-15");

    // move +7: the pinned date leaves the window; the next week carries no pin
    const ahead = hydrateWindow(model.mealsByDate, model.dayConfigByDate, "2026-06-22", 1, makeFreshDay);
    expect(ahead.days[0].pinnedRecipe).toBeUndefined();
    expect(ahead.meals).toEqual({});

    // merge the away week, move back: pin, materialized meal, and stamp all intact
    model = mergeWindowIntoDateModel(model, ahead.days, ahead.meals, "2026-06-22");
    const back = hydrateWindow(model.mealsByDate, model.dayConfigByDate, "2026-06-15", 1, makeFreshDay);
    expect(back.days[0].id).toBe("p");
    expect(back.days[0].pinnedRecipe).toEqual(recipe);
    expect(back.meals.p.pinned).toBe(true);
    expect(back.meals.p.data.name).toBe("Friday Pizza");
    expect(back.meals.p.orderedAt).toBe("2026-06-14T18:00:00.000Z");
  });

  it("a partial window shift keeps overlapping dates' meals on their dates", () => {
    const days = [day("a"), day("b"), day("c")];
    const meals = { a: accepted("Tacos"), b: accepted("Soup"), c: accepted("Curry") };
    const model = mergeWindowIntoDateModel(emptyDateModel(), days, meals, "2026-06-15");
    const out = hydrateWindow(model.mealsByDate, model.dayConfigByDate, "2026-06-16", 3, makeFreshDay);
    expect(out.days[0].id).toBe("b");
    expect(out.days[1].id).toBe("c");
    expect(out.meals.b.data.name).toBe("Soup");
    expect(out.meals.c.data.name).toBe("Curry");
    expect(out.meals[out.days[2].id]).toBeUndefined(); // new trailing date: no meal
  });
});

describe("migrateLegacyBlob", () => {
  it("produces the correct date model from a captured pre-Phase-A payload", () => {
    // shape captured from a TER-388-era alldeezmeals-v1 payload (savedAt/savedBy + legacy keys, no date model)
    const blob = {
      savedAt: "2026-06-10T18:00:00.000Z",
      savedBy: "user-1",
      location: { name: "Springfield, IL", lat: 39.7817, lon: -89.6501 },
      startDate: "2026-06-08",
      numDays: 4,
      days: [day("x1"), day("x2", { skip: true }), day("x3"), day("x4")],
      meals: { x1: accepted("Cobb Salad"), x3: accepted("Chili") },
      staples: [], pantry: [], checkedItems: {}, currentWeek: null,
    };
    const model = migrateLegacyBlob(blob);
    expect(Object.keys(model.dayConfigByDate).sort()).toEqual(["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11"]);
    expect(model.mealsByDate["2026-06-08"].data.name).toBe("Cobb Salad");
    expect(model.mealsByDate["2026-06-09"]).toBeUndefined(); // skipped day, no meal
    expect(model.mealsByDate["2026-06-10"].data.name).toBe("Chili");
    expect(model.dayConfigByDate["2026-06-09"].skip).toBe(true);

    // migrate → hydrate round-trips the legacy window exactly
    const out = hydrateWindow(model.mealsByDate, model.dayConfigByDate, blob.startDate, blob.numDays, makeFreshDay);
    expect(out.days).toEqual(blob.days);
    expect(out.meals).toEqual(blob.meals);
  });

  it("returns an empty model for blobs that cannot anchor positions to dates", () => {
    expect(migrateLegacyBlob(null)).toEqual(emptyDateModel());
    expect(migrateLegacyBlob({})).toEqual(emptyDateModel());
    expect(migrateLegacyBlob({ days: [day("a")], meals: {} })).toEqual(emptyDateModel()); // no startDate
    expect(migrateLegacyBlob({ startDate: "2026-06-08" })).toEqual(emptyDateModel()); // no days
  });
});
