// TER-414: pure request-limit helpers for /api/generate — model allowlist,
// max_tokens clamp, and per-user daily quota decision. Kept pure (no I/O, no
// env reads) so they are vitest-testable; api/generate.ts wires them to the
// request and to Supabase.

export const MAX_TOKENS_MIN = 1;
// Ceiling covers the largest legitimate client request: receipt parsing sends
// 4000 (a long receipt's item JSON exceeds the ~2000 meal-gen recipes need).
export const MAX_TOKENS_MAX = 4000;
export const MAX_TOKENS_DEFAULT = 1000;
export const DEFAULT_DAILY_LIMIT = 100;

// Returns the model id if it is on the allowlist, else null (caller → 400).
export function validateModel(model: unknown, allowedModels: string[]): string | null {
  return typeof model === "string" && allowedModels.includes(model) ? model : null;
}

// Coerce to an integer and clamp to [MIN, MAX]. Absent/empty → default;
// non-numeric garbage also falls back to the default rather than rejecting.
export function clampMaxTokens(value: unknown): number {
  if (value == null || value === "") return MAX_TOKENS_DEFAULT;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return MAX_TOKENS_DEFAULT;
  return Math.min(MAX_TOKENS_MAX, Math.max(MAX_TOKENS_MIN, n));
}

// GENERATE_DAILY_LIMIT env → non-negative integer. 0 is a valid kill switch;
// absent or malformed → DEFAULT_DAILY_LIMIT.
export function parseDailyLimit(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return DEFAULT_DAILY_LIMIT;
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 0) return DEFAULT_DAILY_LIMIT;
  return n;
}

// Quota decision given today's usage count. A null/undefined count means the
// count query failed — fail open (never block legit use on a metering error).
export function isQuotaExceeded(count: number | null | undefined, limit: number): boolean {
  return typeof count === "number" && count >= limit;
}

// ISO timestamp of today's 00:00 UTC, for the llm_usage created_at filter.
export function utcDayStartISO(now: Date): string {
  return now.toISOString().slice(0, 10) + "T00:00:00.000Z";
}
