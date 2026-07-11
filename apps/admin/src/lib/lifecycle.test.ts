import { describe, it, expect } from "vitest";
import { classifyLifecycle, CHURN_DAYS, ATRISK_DAYS, MULTIWEEK_DAYS, type LifecycleInput } from "./lifecycle";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-07-11T00:00:00.000Z");

// `daysAgo` builds an ISO timestamp `n` days before NOW (fractional days allowed
// so we can nudge just past a boundary without landing exactly on it).
function daysAgo(n: number): string {
  return new Date(NOW - n * DAY_MS).toISOString();
}

function user(overrides: Partial<LifecycleInput> & { signupDaysAgo: number; activeDaysAgo: number | null }): LifecycleInput {
  return {
    created_at: daysAgo(overrides.signupDaysAgo),
    last_active: overrides.activeDaysAgo === null ? null : daysAgo(overrides.activeDaysAgo),
    recipes_generated: overrides.recipes_generated ?? 0,
  };
}

describe("classifyLifecycle", () => {
  it("classifies a user active more than CHURN_DAYS ago as churned", () => {
    const u = user({ signupDaysAgo: 60, activeDaysAgo: CHURN_DAYS + 1, recipes_generated: 3 });
    expect(classifyLifecycle(u, NOW)).toBe("churned");
  });

  it("does NOT churn a user active exactly CHURN_DAYS ago (boundary is exclusive)", () => {
    const u = user({ signupDaysAgo: 60, activeDaysAgo: CHURN_DAYS, recipes_generated: 3 });
    expect(classifyLifecycle(u, NOW)).toBe("at_risk");
  });

  it("classifies a never-active user signed up more than CHURN_DAYS ago as churned", () => {
    const u = user({ signupDaysAgo: CHURN_DAYS + 1, activeDaysAgo: null });
    expect(classifyLifecycle(u, NOW)).toBe("churned");
  });

  it("classifies a never-active user signed up exactly CHURN_DAYS ago as new (boundary is exclusive)", () => {
    const u = user({ signupDaysAgo: CHURN_DAYS, activeDaysAgo: null });
    expect(classifyLifecycle(u, NOW)).toBe("new");
  });

  it("classifies a never-active, recently-signed-up user as new", () => {
    const u = user({ signupDaysAgo: 3, activeDaysAgo: null });
    expect(classifyLifecycle(u, NOW)).toBe("new");
  });

  it("classifies a user with zero recipes and recent activity as new, not at-risk or activated", () => {
    const u = user({ signupDaysAgo: 40, activeDaysAgo: 2, recipes_generated: 0 });
    expect(classifyLifecycle(u, NOW)).toBe("new");
  });

  it("classifies a user with a plan, active 20 days ago, as at-risk", () => {
    const u = user({ signupDaysAgo: 60, activeDaysAgo: 20, recipes_generated: 5 });
    expect(classifyLifecycle(u, NOW)).toBe("at_risk");
  });

  it("does NOT flag at-risk a user active exactly ATRISK_DAYS ago (boundary belongs to engaged/activated)", () => {
    const u = user({ signupDaysAgo: ATRISK_DAYS, activeDaysAgo: ATRISK_DAYS, recipes_generated: 2 });
    // span = signupAge - activeAge = 0 < MULTIWEEK_DAYS -> activated, not at-risk.
    expect(classifyLifecycle(u, NOW)).toBe("activated");
  });

  it("classifies a user active just past ATRISK_DAYS as at-risk", () => {
    const u = user({ signupDaysAgo: 60, activeDaysAgo: ATRISK_DAYS + 0.5, recipes_generated: 2 });
    expect(classifyLifecycle(u, NOW)).toBe("at_risk");
  });

  it("classifies a user active today with a 13-day signup-to-activity span as activated", () => {
    const u = user({ signupDaysAgo: 13, activeDaysAgo: 0, recipes_generated: 4 });
    expect(classifyLifecycle(u, NOW)).toBe("activated");
  });

  it("classifies a user active today with a 14-day signup-to-activity span as engaged", () => {
    const u = user({ signupDaysAgo: MULTIWEEK_DAYS, activeDaysAgo: 0, recipes_generated: 4 });
    expect(classifyLifecycle(u, NOW)).toBe("engaged");
  });

  it("classifies a same-day signup-and-activity user with a plan as activated", () => {
    const u = user({ signupDaysAgo: 0, activeDaysAgo: 0, recipes_generated: 1 });
    expect(classifyLifecycle(u, NOW)).toBe("activated");
  });

  it("classifies a user with a plan, active within the window, span just under MULTIWEEK_DAYS as activated", () => {
    const u = user({ signupDaysAgo: MULTIWEEK_DAYS - 0.5, activeDaysAgo: 0, recipes_generated: 2 });
    expect(classifyLifecycle(u, NOW)).toBe("activated");
  });

  it("classifies a user with a plan, active within the window, span just over MULTIWEEK_DAYS as engaged", () => {
    const u = user({ signupDaysAgo: MULTIWEEK_DAYS + 0.5, activeDaysAgo: 0, recipes_generated: 2 });
    expect(classifyLifecycle(u, NOW)).toBe("engaged");
  });
});
