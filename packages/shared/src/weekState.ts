/* TER-388 — week-state persistence logic, extracted pure for unit testing.
 * TER-428: the `currentWeek` projection (projectCurrentWeek and friends) is
 * deleted — the date-keyed model (dateModel.ts) is the canonical store and
 * every view derives from it. Only the date math and the remote-vs-local
 * reconciliation survive here. */

function toISO(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function parseISO(s: string) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
export function addDays(iso: string, n: number) { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }

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
