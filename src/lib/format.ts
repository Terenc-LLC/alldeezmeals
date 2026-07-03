// Frontend-only for now — if this is ever imported into /api, apply the
// .js-specifier rule (TER-500) across the whole transitive import graph.

export function fmtPurchaseQty(qty: number, unit: string, isPurchaseStyle: boolean): string {
  if (isPurchaseStyle) return qty <= 1 ? unit : `${qty} × ${unit}`;
  const q = Number.isInteger(qty) ? qty : Math.round(qty * 100) / 100;
  return unit ? `${q} ${unit}` : String(q);
}
