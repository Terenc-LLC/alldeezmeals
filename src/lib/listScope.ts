/* TER-422 / TER-426 — Phases C and B of the date-anchored meal model (TER-415).
 *
 * The shopping list no longer clears by wiping meals: "mark ordered" stamps
 * `orderedAt` onto each contributing meal entry, and the list derives from the
 * scope below. The stamp lives on the MealEntry (not the date) so a rejected
 * meal's replacement on the same date correctly re-enters the list.
 *
 * Phase B lifts the scope from the planning window to the full forward range of
 * the date model: `listScopeFromModel` is what the app's groceryList chokepoint
 * uses. The window-bounded `listScope` form is no longer wired into the app.
 *
 * Phase D (TER-428) adds `reuseScopeFromModel`: the generation reuse context
 * shares the list's scope so new dinners only coordinate with meals that will
 * share their shopping trip.
 */
import { addDays } from "@terenc/shared/weekState";
import type { DateModel, ISODate } from "@terenc/shared/dateModel";

export type ScopeEntry = { dayId: string; date: ISODate; meal: any };

/**
 * Window meals that still need shopping: accepted ∧ date ≥ today ∧ no
 * `orderedAt` stamp. Skipped days never contribute; legacy meals (no stamp
 * field) are included. Date per window position i is addDays(startDate, i);
 * "≥ today" is an ISO string compare.
 */
export function listScope(
  days: Array<{ id: string; skip?: boolean }>,
  meals: Record<string, any>,
  startDate: string,
  todayISO: ISODate,
): ScopeEntry[] {
  if (!startDate || !Array.isArray(days)) return [];
  const out: ScopeEntry[] = [];
  days.forEach((d, i) => {
    if (d.skip) return;
    const meal = meals[d.id];
    if (meal?.status !== "accepted") return;
    if (meal.orderedAt) return;
    const date = addDays(startDate, i);
    if (date < todayISO) return;
    out.push({ dayId: d.id, date, meal });
  });
  return out;
}

/**
 * TER-426: the full-forward-range scope — every date in the model with an
 * accepted meal, dated today or later, with no `orderedAt` stamp and no skip
 * flag on its day config. Unlike the window form above, this sees every planned
 * week at once (plan next week, move the window back: both weeks' unshopped
 * meals are in scope). Sorted by date; `dayId` comes from the date's stored
 * config so in-window stamping can map back to the runtime `meals` key.
 */
export function listScopeFromModel(model: DateModel, todayISO: ISODate): ScopeEntry[] {
  const out: ScopeEntry[] = [];
  for (const date of Object.keys(model.mealsByDate).sort()) {
    if (date < todayISO) continue;
    const meal = model.mealsByDate[date];
    if (meal?.status !== "accepted") continue;
    if (meal.orderedAt) continue;
    if (model.dayConfigByDate[date]?.skip) continue;
    out.push({ dayId: model.dayConfigByDate[date]?.id ?? "", date, meal });
  }
  return out;
}

/**
 * TER-428: the generation reuse context — the recipe data a new dinner may
 * coordinate ingredient reuse with. Same scope as the shopping list (≥ today,
 * no `orderedAt` stamp, no skip) so provenance never cites ingredients that
 * already left with a stamped trip (PR #101 review §1) — TER-400's repair
 * remains the safety net. Unlike the list, "ready" proposals count too: they
 * join the trip if accepted, and a rejection's replacement must not duplicate
 * a sibling proposal. `excludeDate` drops the day being (re)generated.
 */
export function reuseScopeFromModel(model: DateModel, todayISO: ISODate, excludeDate?: ISODate): any[] {
  const out: any[] = [];
  for (const date of Object.keys(model.mealsByDate).sort()) {
    if (date < todayISO || date === excludeDate) continue;
    const meal = model.mealsByDate[date];
    if (meal?.status !== "accepted" && meal?.status !== "ready") continue;
    if (meal.orderedAt) continue;
    if (model.dayConfigByDate[date]?.skip) continue;
    if (meal.data != null) out.push(meal.data);
  }
  return out;
}
