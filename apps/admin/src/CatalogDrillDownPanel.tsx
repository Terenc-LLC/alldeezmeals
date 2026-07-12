import { useEffect, useState } from "react";
import { AlertCircle, Check, RefreshCw, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import type { CatalogItem } from "@/lib/types";

type ManualVals = { kcal: string; serving_g: string; protein: string; fat: string; carbs: string };
type ActionResult = { ok: boolean; msg: string };

const emptyVals = (item: CatalogItem): ManualVals => ({
  kcal: item.kcal_per_100g != null ? String(item.kcal_per_100g) : "",
  serving_g: item.serving_g != null ? String(item.serving_g) : "",
  protein: item.macros?.protein_g != null ? String(item.macros.protein_g) : "",
  fat: item.macros?.fat_g != null ? String(item.macros.fat_g) : "",
  carbs: item.macros?.carbs_g != null ? String(item.macros.carbs_g) : "",
});

type CatalogDrillDownPanelProps = {
  item: CatalogItem;
  fetching: boolean;
  saving: boolean;
  status: ActionResult | null;
  onClose: () => void;
  onFetchByUpc: (item: CatalogItem) => Promise<ActionResult>;
  onSaveManual: (item: CatalogItem, vals: ManualVals) => Promise<ActionResult>;
};

// TER-513: catalog item drill-down — nutrition summary, USDA/OFF fetch-by-UPC,
// and manual nutrition entry. Same fixed/backdrop slide-over pattern as
// UserDrillDownPanel (TER-511).
export default function CatalogDrillDownPanel({
  item,
  fetching,
  saving,
  status,
  onClose,
  onFetchByUpc,
  onSaveManual,
}: CatalogDrillDownPanelProps) {
  const [manualVals, setManualVals] = useState<ManualVals>(() => emptyVals(item));

  useEffect(() => {
    setManualVals(emptyVals(item));
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayName = item.product_name ?? item.normalized_product;
  const hasNutrition = item.kcal_per_100g != null;
  const srcLabel = item.nutrition_source === "usda" ? "USDA" : item.nutrition_source === "off" ? "OFF" : item.nutrition_source === "manual" ? "Manual" : null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="animate-in slide-in-from-right fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card duration-200">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-foreground">{displayName}</h3>
            <p className="truncate text-sm text-muted-foreground">{item.category ?? item.normalized_product}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-6 px-5 py-5">
          <section>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Nutrition</h4>
            {hasNutrition ? (
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Calories</dt>
                <dd className="text-foreground">{Math.round(item.kcal_per_100g!)}/100g</dd>
                <dt className="text-muted-foreground">Serving</dt>
                <dd className="text-foreground">{item.serving_g != null ? `${item.serving_g}g` : "—"}</dd>
                <dt className="text-muted-foreground">Protein / Fat / Carbs</dt>
                <dd className="text-foreground">
                  {item.macros ? `${item.macros.protein_g}g / ${item.macros.fat_g}g / ${item.macros.carbs_g}g` : "—"}
                </dd>
                <dt className="text-muted-foreground">Source</dt>
                <dd className="text-foreground">{srcLabel ? <Badge variant="secondary">{srcLabel}</Badge> : "—"}</dd>
                <dt className="text-muted-foreground">Retrieved</dt>
                <dd className="text-foreground">{formatDate(item.nutrition_retrieved_at)}</dd>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No nutrition data yet.</p>
            )}
          </section>

          {item.upc && (
            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">UPC lookup</h4>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" disabled={fetching} onClick={() => onFetchByUpc(item)}>
                  {fetching ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" /> Fetching…
                    </>
                  ) : (
                    <>
                      <Sparkles size={13} /> Fetch nutrition by UPC
                    </>
                  )}
                </Button>
                <span className="font-mono text-xs text-muted-foreground">{item.upc}</span>
              </div>
            </section>
          )}

          {status && (
            <p className={`flex items-center gap-1.5 text-sm ${status.ok ? "text-primary" : "text-destructive"}`}>
              {status.ok ? <Check size={13} /> : <AlertCircle size={13} />} {status.msg}
            </p>
          )}

          <section className="flex flex-col gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Manual nutrition</h4>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { label: "Calories/100g", key: "kcal" as const },
                  { label: "Serving g", key: "serving_g" as const },
                  { label: "Protein g", key: "protein" as const },
                  { label: "Fat g", key: "fat" as const },
                  { label: "Carbs g", key: "carbs" as const },
                ]
              ).map(({ label, key }) => (
                <div key={key} className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">{label}</label>
                  <input
                    type="number"
                    value={manualVals[key]}
                    onChange={(e) => setManualVals((p) => ({ ...p, [key]: e.target.value }))}
                    className="h-9 w-24 rounded-md border border-border bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
              ))}
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="w-fit"
              disabled={saving || !manualVals.kcal}
              onClick={() => onSaveManual(item, manualVals)}
            >
              {saving ? (
                <>
                  <RefreshCw size={13} className="animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Check size={13} /> Save manual
                </>
              )}
            </Button>
          </section>
        </div>
      </div>
    </>
  );
}
