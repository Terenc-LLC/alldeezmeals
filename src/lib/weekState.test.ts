import { describe, it, expect } from "vitest";
import { addDays, projectCurrentWeek, advanceStartDate, shouldApplyRemoteState } from "./weekState";

const day = (id: string, overrides: Record<string, any> = {}) => ({
  id, people: 4, cuisine: "Any", temp: "Auto", effort: "any", note: "", pinnedRecipe: undefined, skip: false, ...overrides,
});
const accepted = (name: string) => ({ status: "accepted", data: { name, ingredients: [] }, error: null, kcalInfo: null });

describe("addDays", () => {
  it("adds within a month", () => expect(addDays("2026-06-10", 3)).toBe("2026-06-13"));
  it("rolls over month boundaries", () => expect(addDays("2026-06-29", 3)).toBe("2026-07-02"));
  it("rolls over year boundaries", () => expect(addDays("2026-12-30", 7)).toBe("2027-01-06"));
});

describe("advanceStartDate", () => {
  it("advances exactly 7 days", () => expect(advanceStartDate("2026-06-12")).toBe("2026-06-19"));
  it("crosses month boundaries", () => expect(advanceStartDate("2026-06-28")).toBe("2026-07-05"));
});

describe("projectCurrentWeek", () => {
  const days = [day("a"), day("b", { skip: true }), day("c"), day("d")];

  it("includes accepted meals and skipped days only, sorted by date", () => {
    const meals = { a: accepted("Tacos"), c: accepted("Soup"), d: { status: "suggested", data: { name: "Nope" } } };
    const week = projectCurrentWeek(days, meals, "2026-06-12", 4);
    expect(week.startDate).toBe("2026-06-12");
    expect(week.numDays).toBe(4);
    expect(week.entries.map((e) => e.date)).toEqual(["2026-06-12", "2026-06-13", "2026-06-14"]);
    expect(week.entries.map((e) => e.skip)).toEqual([false, true, false]);
    expect(week.entries[0].meal.data.name).toBe("Tacos");
    expect(week.entries[1].meal).toBeNull();
    expect(week.entries[2].meal.data.name).toBe("Soup");
  });

  it("a skipped day never carries a meal, even if one is orphaned in state", () => {
    const week = projectCurrentWeek([day("b", { skip: true })], { b: accepted("Ghost") }, "2026-06-12", 1);
    expect(week.entries).toEqual([{ day: expect.objectContaining({ id: "b" }), date: "2026-06-12", meal: null, skip: true }]);
  });

  it("returns empty entries when nothing is accepted or skipped", () => {
    const week = projectCurrentWeek([day("a"), day("c")], {}, "2026-06-12", 2);
    expect(week.entries).toEqual([]);
  });

  it("ignores meal keys that match no day (orphans)", () => {
    const week = projectCurrentWeek([day("a")], { zz: accepted("Orphan"), a: accepted("Real") }, "2026-06-12", 1);
    expect(week.entries).toHaveLength(1);
    expect(week.entries[0].meal.data.name).toBe("Real");
  });

  it("projects the exact accepted subset after a reject (no stale carryover)", () => {
    const meals: Record<string, any> = { a: accepted("Tacos"), c: accepted("Soup") };
    const before = projectCurrentWeek(days, meals, "2026-06-12", 4);
    expect(before.entries.filter((e) => !e.skip)).toHaveLength(2);
    delete meals.c; // reject
    const after = projectCurrentWeek(days, meals, "2026-06-12", 4);
    expect(after.entries.filter((e) => !e.skip).map((e) => e.meal.data.name)).toEqual(["Tacos"]);
  });

  it("handles a pre-fix persisted blob shape (I-4: no savedAt/savedBy)", () => {
    // shape captured from a pre-TER-388 alldeezmeals-v1 payload
    const blob = {
      location: { name: "Bloomfield, IA", lat: 40.7517, lon: -92.4154 },
      startDate: "2026-06-01",
      numDays: 7,
      days: [day("x1"), day("x2", { skip: true })],
      meals: { x1: accepted("Old Cobb Salad") },
      checkedItems: { "lettuce|each": true },
      currentWeek: null,
    };
    const week = projectCurrentWeek(blob.days, blob.meals, blob.startDate, blob.numDays);
    expect(week.entries.map((e) => [e.date, e.skip])).toEqual([["2026-06-01", false], ["2026-06-02", true]]);
  });
});

describe("shouldApplyRemoteState", () => {
  const u = "user-1";
  const base = { localSavedAt: "2026-06-12T10:00:00.000Z", localSavedBy: u, userId: u };

  it("applies remote when it is strictly newer than local", () => {
    expect(shouldApplyRemoteState({ ...base, remoteStamp: "2026-06-12T10:00:01.000Z" })).toBe(true);
  });
  it("keeps local when remote is older (the reload-clobber bug)", () => {
    expect(shouldApplyRemoteState({ ...base, remoteStamp: "2026-06-12T09:59:59.000Z" })).toBe(false);
  });
  it("keeps local when stamps are equal (flush completed; contents identical)", () => {
    expect(shouldApplyRemoteState({ ...base, remoteStamp: base.localSavedAt })).toBe(false);
  });
  it("applies remote when local blob is unstamped (pre-fix blob or fresh device)", () => {
    expect(shouldApplyRemoteState({ localSavedAt: null, localSavedBy: null, remoteStamp: null, userId: u })).toBe(true);
  });
  it("applies remote when local blob belongs to a different user (shared device)", () => {
    expect(shouldApplyRemoteState({ ...base, localSavedBy: "user-2", remoteStamp: "2026-06-11T00:00:00.000Z" })).toBe(true);
  });
  it("keeps same-user local when remote has no stamp at all", () => {
    expect(shouldApplyRemoteState({ ...base, remoteStamp: null })).toBe(false);
  });
});
