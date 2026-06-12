/* TER-418 — Phase A of the date-anchored meal model (TER-415).
 *
 * The canonical persisted shape becomes date-keyed: `mealsByDate` and
 * `dayConfigByDate` hold every date ever planned, while the runtime keeps
 * today's positional `days[]` + `meals` keyed by `day.id`. Conversion happens
 * at the persistence boundary via the pure functions below.
 */
import { addDays } from "./weekState";

export type ISODate = string; // "2026-06-15"

export type DayConfig = {
  id: string;
  people: number;
  cuisine: string;
  temp: string;
  effort: string;
  note: string;
  pinnedRecipe: any; // undefined when unpinned (matches App's makeDay shape)
  skip: boolean;
};

export type DateModel = {
  mealsByDate: Record<ISODate, any>;
  dayConfigByDate: Record<ISODate, DayConfig>;
};

export const emptyDateModel = (): DateModel => ({ mealsByDate: {}, dayConfigByDate: {} });

/**
 * Write the runtime window into the date model. Each window position i maps to
 * addDays(startDate, i); window state overwrites those dates. A window day with
 * no meal (rejected/emptied) clears that date's meal. Dates outside the window
 * are untouchable by construction — this map accumulates every date ever planned.
 *
 * Returns `prev` unchanged (same reference) when the window contributes nothing
 * new, so callers can save/merge without churning on identical state.
 */
export function mergeWindowIntoDateModel(
  prev: DateModel,
  days: DayConfig[],
  meals: Record<string, any>,
  startDate: string,
): DateModel {
  if (!startDate || !Array.isArray(days) || days.length === 0) return prev;
  const mealsByDate = { ...prev.mealsByDate };
  const dayConfigByDate = { ...prev.dayConfigByDate };
  let changed = false;
  days.forEach((day, i) => {
    const date = addDays(startDate, i);
    if (dayConfigByDate[date] !== day) { dayConfigByDate[date] = day; changed = true; }
    const meal = meals[day.id];
    if (meal != null) {
      if (mealsByDate[date] !== meal) { mealsByDate[date] = meal; changed = true; }
    } else if (date in mealsByDate) {
      delete mealsByDate[date];
      changed = true;
    }
  });
  return changed ? { mealsByDate, dayConfigByDate } : prev;
}

/**
 * Build the runtime window from the date model. Dates that already have a
 * config keep it (so `day.id` — and everything keyed off it — is stable across
 * reloads and window moves); dates never planned get a fresh config from
 * `makeDayConfig`. Meals re-key from date back to the config's id.
 */
export function hydrateWindow(
  mealsByDate: Record<ISODate, any>,
  dayConfigByDate: Record<ISODate, DayConfig>,
  startDate: string,
  numDays: number,
  makeDayConfig: () => DayConfig,
): { days: DayConfig[]; meals: Record<string, any> } {
  const days: DayConfig[] = [];
  const meals: Record<string, any> = {};
  for (let i = 0; i < numDays; i++) {
    const date = addDays(startDate, i);
    const day = dayConfigByDate[date] ?? makeDayConfig();
    days.push(day);
    const meal = mealsByDate[date];
    if (meal != null) meals[day.id] = meal;
  }
  return { days, meals };
}

/**
 * Build a date model from a pre-Phase-A payload (positional `days[]` + `meals`
 * + `startDate`, the TER-388-era shape). A blob with no startDate cannot anchor
 * positions to dates, so it migrates to an empty model and the legacy keys keep
 * driving the runtime as before.
 */
export function migrateLegacyBlob(blob: any): DateModel {
  if (!blob || typeof blob !== "object" || !blob.startDate || !Array.isArray(blob.days)) {
    return emptyDateModel();
  }
  return mergeWindowIntoDateModel(emptyDateModel(), blob.days, blob.meals ?? {}, blob.startDate);
}
