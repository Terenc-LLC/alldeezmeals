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
 */
import { addDays } from "./weekState";
import type { DateModel, ISODate } from "./dateModel";

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
