import { normalizeIngName } from "./normalize";
import { CATEGORIES } from "./recipeGenerate.js";

/**
 * TER-504: an item is dropped from the weekly buy if its normalized name is in
 * the durable `alwaysHave` exclusion list OR the per-week `weekHaveIt` override.
 *
 * Single chokepoint predicate — used by the `groceryList` memo in App.tsx so that
 * `listText`, the Instacart handoff, and every downstream view inherit the same
 * exclusion. `alwaysHave` is a permanent staple ("I always keep this stocked");
 * `weekHaveIt` is a per-week "I already have it for this trip" override that clears
 * on Mark Purchased and never touches the durable list.
 */
export function isExcludedFromWeeklyList(
  name: string,
  alwaysHave: string[],
  weekHaveIt: string[],
): boolean {
  const k = normalizeIngName(name);
  return alwaysHave.includes(k) || weekHaveIt.includes(k);
}

/**
 * TER-504: user-added items carry a `category`. Legacy persisted additions predate
 * that field; default them (and any unknown value) to "Other" at render time — a
 * purely additive, backward-compatible default with no migration script.
 */
export function additionCategory(category: unknown): string {
  return typeof category === "string" && CATEGORIES.includes(category) ? category : "Other";
}
