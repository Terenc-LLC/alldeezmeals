/* TER-422 — Phase C of the date-anchored meal model (TER-415).
 *
 * The shopping list no longer clears by wiping meals: "mark ordered" stamps
 * `orderedAt` onto each contributing meal entry, and the list derives from the
 * scope below. The stamp lives on the MealEntry (not the date) so a rejected
 * meal's replacement on the same date correctly re-enters the list.
 *
 * Scope is window-bounded in this phase (the date model is a non-reactive ref —
 * Phase A design); Phase B promotes the model to state and lifts the scope to
 * the full forward range. In normal use (window = current planning range) the
 * two are identical.
 */
import { addDays } from "./weekState";
import type { ISODate } from "./dateModel";

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
