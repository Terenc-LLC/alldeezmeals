// Lifecycle-state classification (TER-511, spec shared with TER-516/TER-517 —
// see the TER-511 dispatch comment). Defined once here so the Users directory
// and the Phase 2 lifecycle analytics view (TER-517) share the same rule
// instead of drifting into two definitions of "at-risk".
export type LifecycleState = "new" | "activated" | "engaged" | "at_risk" | "churned";

export const LIFECYCLE_STATES: LifecycleState[] = ["new", "activated", "engaged", "at_risk", "churned"];

export const LIFECYCLE_LABELS: Record<LifecycleState, string> = {
  new: "New",
  activated: "Activated",
  engaged: "Engaged",
  at_risk: "At-risk",
  churned: "Churned",
};

export const LIFECYCLE_BADGE_CLASSES: Record<LifecycleState, string> = {
  new: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  activated: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  engaged: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  at_risk: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  churned: "bg-zinc-500/15 text-zinc-500 dark:text-zinc-400",
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Founder-tunable thresholds (days), named per the dispatched spec.
export const CHURN_DAYS = 28;
export const ATRISK_DAYS = 14;
export const MULTIWEEK_DAYS = 14;

function daysSince(iso: string, now: number): number {
  return (now - new Date(iso).getTime()) / DAY_MS;
}

export type LifecycleInput = {
  created_at: string;
  last_active: string | null;
  recipes_generated: number;
};

// Ordered rules, first match wins, evaluated against a single `now` snapshot:
//  1. Churned    — inactive >CHURN_DAYS, or never active and signed up >CHURN_DAYS ago.
//  2. At-risk    — has generated a plan, last active between ATRISK_DAYS and CHURN_DAYS ago.
//  3. Engaged    — has generated a plan, active within ATRISK_DAYS, and the span from
//                  signup to last activity is >=MULTIWEEK_DAYS (multi-week engagement).
//  4. Activated  — has generated a plan, active within ATRISK_DAYS (still single-week).
//  5. New        — everything else (no plan generated yet, or too early to tell).
export function classifyLifecycle(user: LifecycleInput, now: number = Date.now()): LifecycleState {
  const signupAge = daysSince(user.created_at, now);
  const activeAge = user.last_active ? daysSince(user.last_active, now) : null;
  const hasPlan = user.recipes_generated > 0;

  if ((activeAge !== null && activeAge > CHURN_DAYS) || (activeAge === null && signupAge > CHURN_DAYS)) {
    return "churned";
  }
  if (hasPlan && activeAge !== null && activeAge > ATRISK_DAYS && activeAge <= CHURN_DAYS) {
    return "at_risk";
  }
  if (hasPlan && activeAge !== null && activeAge <= ATRISK_DAYS && signupAge - activeAge >= MULTIWEEK_DAYS) {
    return "engaged";
  }
  if (hasPlan && activeAge !== null && activeAge <= ATRISK_DAYS) {
    return "activated";
  }
  return "new";
}
