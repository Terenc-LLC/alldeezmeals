// Lifecycle-state classification (TER-511). Defined once here so the Users
// directory and the Phase 2 lifecycle analytics view (TER-517) share the same
// rule instead of drifting into two definitions of "at-risk".
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
const NEW_WINDOW_DAYS = 7;
const AT_RISK_AFTER_DAYS = 14;
const CHURNED_AFTER_DAYS = 30;
const ENGAGED_RECIPES = 3;
const ENGAGED_DINNERS = 1;

function daysSince(iso: string, now: number): number {
  return (now - new Date(iso).getTime()) / DAY_MS;
}

export type LifecycleInput = {
  created_at: string;
  last_active: string | null;
  recipes_generated: number;
  dinners_accepted: number;
};

// First-cut heuristic, evaluated as ordered rules against a single `now` snapshot:
//  - never active: New if signed up recently, else Churned (never activated).
//  - active >30d ago: Churned. Active 14-30d ago: At-risk.
//  - active <=14d ago: Engaged if past the activity bar, else New (still in the
//    signup window) or Activated (past it, light usage so far).
export function classifyLifecycle(user: LifecycleInput, now: number = Date.now()): LifecycleState {
  const signupAge = daysSince(user.created_at, now);

  if (!user.last_active) {
    return signupAge <= NEW_WINDOW_DAYS ? "new" : "churned";
  }

  const activeAge = daysSince(user.last_active, now);
  if (activeAge > CHURNED_AFTER_DAYS) return "churned";
  if (activeAge > AT_RISK_AFTER_DAYS) return "at_risk";

  const isEngaged = user.recipes_generated >= ENGAGED_RECIPES || user.dinners_accepted >= ENGAGED_DINNERS;
  if (isEngaged) return "engaged";

  return signupAge <= NEW_WINDOW_DAYS ? "new" : "activated";
}
