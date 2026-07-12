import { useEffect, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REJECT_CATEGORIES, type PendingRecipe } from "@/lib/types";

// TER-512: pending-recipe review carousel — one card at a time, approve or
// reject-with-category. Ports the TER-357 carousel out of the old CatalogView
// (deleted in TER-510) into the admin app's design system.
export default function RecipeReviewQueue({ session }: { session: any }) {
  const [recipes, setRecipes] = useState<PendingRecipe[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectCategory, setRejectCategory] = useState("");
  const [rejectNote, setRejectNote] = useState("");

  const token = session?.access_token ?? "";

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/list-pending-recipes?limit=50", {
        headers: { authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      setRecipes(data.recipes ?? []);
      setIdx(0);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load pending recipes.");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const resetRejectForm = () => {
    setRejecting(false);
    setRejectCategory("");
    setRejectNote("");
  };

  const removeCurrent = () => {
    setRecipes((p) => {
      const next = (p ?? []).filter((_, i) => i !== idx);
      setIdx((i) => Math.min(i, Math.max(0, next.length - 1)));
      return next;
    });
  };

  const handleApprove = async (id: number) => {
    setBusy(true);
    setActionError("");
    try {
      const r = await fetch("/api/review-recipe", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, decision: "approve" }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      removeCurrent();
    } catch (e: any) {
      setActionError(e?.message ?? "Approve failed.");
    }
    setBusy(false);
  };

  const handleReject = async (id: number) => {
    if (!rejectCategory) return;
    setBusy(true);
    setActionError("");
    try {
      const r = await fetch("/api/review-recipe", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, decision: "reject", category: rejectCategory, reason: rejectNote || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      resetRejectForm();
      removeCurrent();
    } catch (e: any) {
      setActionError(e?.message ?? "Reject failed.");
    }
    setBusy(false);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading pending recipes…</p>;
  }

  if (error) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-destructive">
        <AlertCircle size={14} /> {error}
      </p>
    );
  }

  const list = recipes ?? [];
  const recipe = list[idx];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">Pending recipes ({list.length})</h2>
        <div className="flex items-center gap-2">
          {list.length > 1 && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                disabled={idx === 0}
                onClick={() => {
                  resetRejectForm();
                  setIdx((i) => Math.max(0, i - 1));
                }}
                aria-label="Previous recipe"
              >
                <ChevronLeft size={16} />
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {idx + 1} / {list.length}
              </span>
              <Button
                variant="ghost"
                size="icon"
                disabled={idx === list.length - 1}
                onClick={() => {
                  resetRejectForm();
                  setIdx((i) => Math.min(list.length - 1, i + 1));
                }}
                aria-label="Next recipe"
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>
      </div>

      {!recipe && (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <Inbox size={28} />
          <p className="text-sm">No pending recipes</p>
        </div>
      )}

      {recipe && (
        <div className="rounded-lg border border-border bg-card p-4" style={{ boxShadow: "var(--elev-1)" }}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground">{recipe.name}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {[
                  recipe.cuisine,
                  recipe.servings != null ? `${recipe.servings} srv` : null,
                  recipe.difficulty != null ? `diff ${recipe.difficulty}` : null,
                  recipe.model,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>

              <h4 className="mt-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Ingredients</h4>
              <ul className="mt-1 list-disc pl-5 text-sm text-foreground">
                {(recipe.ingredients ?? []).map((ing, i) => (
                  <li key={i}>
                    {ing.recipeAmount?.qty != null
                      ? `${ing.recipeAmount.qty}${ing.recipeAmount.unit ? ` ${ing.recipeAmount.unit}` : ""} `
                      : ""}
                    {ing.name}
                    {ing.source && ing.source !== "buy" && (
                      <span className="text-muted-foreground italic"> ({ing.source})</span>
                    )}
                  </li>
                ))}
              </ul>

              <h4 className="mt-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Steps</h4>
              <ol className="mt-1 list-decimal pl-5 text-sm text-foreground">
                {(recipe.steps ?? []).map((step, i) => (
                  <li key={i} className="mb-1">
                    {String(step)}
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              <Button disabled={busy} onClick={() => handleApprove(recipe.id)}>
                {busy && !rejecting ? "…" : "Approve"}
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  setRejecting((v) => !v);
                  setRejectCategory("");
                  setRejectNote("");
                }}
              >
                Reject
              </Button>
            </div>
          </div>

          {actionError && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle size={14} /> {actionError}
            </p>
          )}

          {rejecting && (
            <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Category <span className="text-destructive">*</span>
                </label>
                <select
                  value={rejectCategory}
                  onChange={(e) => setRejectCategory(e.target.value)}
                  className="h-9 w-full rounded-md border border-border bg-card px-2 text-sm text-foreground"
                >
                  <option value="">— select —</option>
                  {REJECT_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Note (optional)</label>
                <textarea
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  rows={2}
                  placeholder="Optional explanation…"
                  className="w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="destructive" disabled={!rejectCategory || busy} onClick={() => handleReject(recipe.id)}>
                  {busy ? "…" : "Confirm reject"}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={resetRejectForm}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
