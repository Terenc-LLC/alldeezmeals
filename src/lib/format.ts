// Frontend-only for now — if this is ever imported into /api, apply the
// .js-specifier rule (TER-500) across the whole transitive import graph.

export function fmtPurchaseQty(qty: number, unit: string, isPurchaseStyle: boolean): string {
  if (isPurchaseStyle) return qty <= 1 ? unit : `${qty} × ${unit}`;
  const q = Number.isInteger(qty) ? qty : Math.round(qty * 100) / 100;
  return unit ? `${q} ${unit}` : String(q);
}

export const DIFFICULTY_LABELS = ["Premade", "Minimal", "Simple", "Moderate", "Involved", "Intricate"] as const;

export function fmtRecipeQty(ing: any): string {
  if (ing.recipeAmount) {
    const { qty, unit } = ing.recipeAmount;
    if (!qty) return "";
    const q = Number.isInteger(qty) ? qty : Math.round(qty * 100) / 100;
    return `${q}${unit ? " " + unit : ""}`;
  }
  if (!ing.qty) return "";
  const q = Number.isInteger(ing.qty) ? ing.qty : Math.round(ing.qty * 100) / 100;
  return `${q}${ing.unit ? " " + ing.unit : ""}`;
}

// TER-401: rendered from the structured term list, never from an LLM echo —
// every restriction is always named. Keep the "verify every label" sentence verbatim.
export function dietaryDisclaimer(items: string[]): string {
  return `Generated to avoid: ${items.join(", ")}. Verify every ingredient and package label yourself — not an allergen-safety guarantee.`;
}
