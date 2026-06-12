/* TER-388 — week-state persistence logic, extracted pure for unit testing. */

function toISO(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function parseISO(s: string) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
export function addDays(iso: string, n: number) { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }

export type WeekEntry = { day: any; date: string; meal: any; skip: boolean };
export type CurrentWeek = { startDate: string; numDays: number; entries: WeekEntry[] };

/**
 * "This Week" is a projection of the accepted meals: one entry per accepted day
 * (meal attached) plus one per skipped day (meal null), sorted by date. Days with
 * no accepted meal are omitted. Recomputing this on every accept/reject change is
 * what makes a stale currentWeek impossible (invariant I-2).
 */
export function projectCurrentWeek(
  days: any[],
  meals: Record<string, any>,
  startDate: string,
  numDays: number,
): CurrentWeek {
  const entries = days
    .map((d, i): WeekEntry => (
      d.skip
        ? { day: d, date: addDays(startDate, i), meal: null, skip: true }
        : { day: d, date: addDays(startDate, i), meal: meals[d.id] ?? null, skip: false }
    ))
    .filter((e) => e.skip || e.meal?.status === "accepted")
    .sort((a, b) => a.date.localeCompare(b.date));
  return { startDate, numDays, entries };
}

/** "Start next week" rolls the plan forward one week (invariant I-3). */
export function advanceStartDate(startDate: string) {
  return addDays(startDate, 7);
}

/**
 * Single-device reload safety (invariant I-1): the remote user_state row may lag
 * local state by the 2 s upsert debounce (or an upsert killed by the unload), so
 * applying it blindly on load can clobber newer local data. Apply remote only if
 * it is strictly newer than the local blob — and only trust the local stamp when
 * the blob was written by the same signed-in user, so switching accounts on a
 * shared device still pulls the new user's remote state.
 *
 * Unstamped local blobs (pre-TER-388, or no blob at all) keep the old behavior:
 * remote wins. An unstamped remote against a stamped same-user local keeps local.
 */
export function shouldApplyRemoteState(opts: {
  localSavedAt: string | null;
  localSavedBy: string | null;
  remoteStamp: string | null;
  userId: string;
}): boolean {
  const { localSavedAt, localSavedBy, remoteStamp, userId } = opts;
  if (!localSavedAt || localSavedBy !== userId) return true;
  if (!remoteStamp) return false;
  return remoteStamp > localSavedAt;
}
