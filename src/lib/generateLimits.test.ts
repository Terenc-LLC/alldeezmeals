import { describe, it, expect } from "vitest";
import {
  validateModel,
  clampMaxTokens,
  parseDailyLimit,
  isQuotaExceeded,
  utcDayStartISO,
  MAX_TOKENS_MIN,
  MAX_TOKENS_MAX,
  MAX_TOKENS_DEFAULT,
  DEFAULT_DAILY_LIMIT,
} from "./generateLimits";

// Mirrors the LLM_RATES keys in api/generate.ts.
const ALLOWED = ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"];

describe("validateModel", () => {
  it("passes every allowlisted model", () => {
    for (const m of ALLOWED) expect(validateModel(m, ALLOWED)).toBe(m);
  });
  it("rejects unknown models", () => {
    expect(validateModel("claude-opus-4-8", ALLOWED)).toBeNull();
    expect(validateModel("gpt-4o", ALLOWED)).toBeNull();
  });
  it("rejects absent or non-string models", () => {
    expect(validateModel(undefined, ALLOWED)).toBeNull();
    expect(validateModel(null, ALLOWED)).toBeNull();
    expect(validateModel(42, ALLOWED)).toBeNull();
    expect(validateModel({ model: ALLOWED[0] }, ALLOWED)).toBeNull();
  });
});

describe("clampMaxTokens", () => {
  it("clamps huge values to the ceiling", () => {
    expect(clampMaxTokens(999999)).toBe(MAX_TOKENS_MAX);
    expect(clampMaxTokens(5000)).toBe(MAX_TOKENS_MAX);
  });
  it("clamps zero/negative values to the floor", () => {
    expect(clampMaxTokens(0)).toBe(MAX_TOKENS_MIN);
    expect(clampMaxTokens(-50)).toBe(MAX_TOKENS_MIN);
  });
  it("preserves the default when absent", () => {
    expect(clampMaxTokens(undefined)).toBe(MAX_TOKENS_DEFAULT);
    expect(clampMaxTokens(null)).toBe(MAX_TOKENS_DEFAULT);
    expect(clampMaxTokens("")).toBe(MAX_TOKENS_DEFAULT);
  });
  it("passes in-range values through, truncated to integers", () => {
    expect(clampMaxTokens(1000)).toBe(1000);
    expect(clampMaxTokens(1500.9)).toBe(1500);
    expect(clampMaxTokens("2000")).toBe(2000);
  });
  it("falls back to the default on garbage", () => {
    expect(clampMaxTokens("lots")).toBe(MAX_TOKENS_DEFAULT);
    expect(clampMaxTokens(NaN)).toBe(MAX_TOKENS_DEFAULT);
  });
});

describe("parseDailyLimit", () => {
  it("defaults when unset or blank", () => {
    expect(parseDailyLimit(undefined)).toBe(DEFAULT_DAILY_LIMIT);
    expect(parseDailyLimit("")).toBe(DEFAULT_DAILY_LIMIT);
    expect(parseDailyLimit("  ")).toBe(DEFAULT_DAILY_LIMIT);
  });
  it("parses valid overrides, including the low test value", () => {
    expect(parseDailyLimit("3")).toBe(3);
    expect(parseDailyLimit("250")).toBe(250);
  });
  it("accepts 0 as a kill switch", () => {
    expect(parseDailyLimit("0")).toBe(0);
  });
  it("defaults on malformed or negative values", () => {
    expect(parseDailyLimit("abc")).toBe(DEFAULT_DAILY_LIMIT);
    expect(parseDailyLimit("-5")).toBe(DEFAULT_DAILY_LIMIT);
  });
});

describe("isQuotaExceeded", () => {
  it("blocks at and over the limit", () => {
    expect(isQuotaExceeded(100, 100)).toBe(true);
    expect(isQuotaExceeded(150, 100)).toBe(true);
    expect(isQuotaExceeded(3, 3)).toBe(true);
  });
  it("allows under the limit", () => {
    expect(isQuotaExceeded(99, 100)).toBe(false);
    expect(isQuotaExceeded(0, 100)).toBe(false);
  });
  it("fails open when the count is unavailable", () => {
    expect(isQuotaExceeded(null, 100)).toBe(false);
    expect(isQuotaExceeded(undefined, 100)).toBe(false);
  });
  it("blocks everything when the limit is 0", () => {
    expect(isQuotaExceeded(0, 0)).toBe(true);
  });
});

describe("utcDayStartISO", () => {
  it("returns today's 00:00 UTC for any time of day", () => {
    expect(utcDayStartISO(new Date("2026-06-12T23:59:59.999Z"))).toBe("2026-06-12T00:00:00.000Z");
    expect(utcDayStartISO(new Date("2026-06-12T00:00:00.000Z"))).toBe("2026-06-12T00:00:00.000Z");
  });
  it("respects UTC, not local time", () => {
    // 2026-06-13T03:00Z is still the 12th in US timezones; UTC day is the 13th.
    expect(utcDayStartISO(new Date("2026-06-13T03:00:00.000Z"))).toBe("2026-06-13T00:00:00.000Z");
  });
});
