import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FeedbackItem } from "@/lib/types";

type TriageFilter = "all" | "unhandled" | "handled";

const CATEGORY_LABEL: Record<string, string> = { bug: "Bug", idea: "Idea", other: "Other" };

// TER-514: ports the feedback list out of the old CatalogView.tsx (TER-492,
// deleted in TER-510) into the admin app's design system, plus a lightweight
// mark-handled triage state (new: migration 20260711_021, POST
// /api/mark-feedback-handled). Desktop-first — no mobile-specific layout.
export default function FeedbackViewer({ session }: { session: any }) {
  const [feedback, setFeedback] = useState<FeedbackItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<TriageFilter>("unhandled");
  const [busyId, setBusyId] = useState<string | null>(null);

  const token = session?.access_token ?? "";

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/list-feedback", { headers: { authorization: `Bearer ${token}` } });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      setFeedback(data.feedback ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load feedback.");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const toggleHandled = async (item: FeedbackItem) => {
    const nextHandled = !item.handled;
    setBusyId(item.id);
    try {
      const r = await fetch("/api/mark-feedback-handled", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: item.id, handled: nextHandled }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      setFeedback((p) =>
        (p ?? []).map((f) => (f.id === item.id ? { ...f, handled: nextHandled, handled_at: nextHandled ? new Date().toISOString() : null } : f))
      );
    } catch (e: any) {
      setError(e?.message ?? "Failed to update feedback.");
    }
    setBusyId(null);
  };

  const list = feedback ?? [];
  const filtered = useMemo(
    () =>
      list.filter((f) => {
        if (filter === "handled") return f.handled;
        if (filter === "unhandled") return !f.handled;
        return true;
      }),
    [list, filter]
  );

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading feedback…</p>;
  }

  if (error) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-destructive">
        <AlertCircle size={14} /> {error}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">
          Feedback ({filtered.length}
          {filtered.length !== list.length ? ` of ${list.length}` : ""})
        </h2>
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["unhandled", "handled", "all"] as const).map((f) => (
          <Button key={f} variant={filter === f ? "default" : "secondary"} size="sm" onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {filter === "unhandled" ? "No unhandled feedback — all caught up." : "No feedback here."}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {filtered.map((fb) => {
          const name = [fb.first_name, fb.last_name].filter(Boolean).join(" ") || fb.email || "—";
          const categoryLabel = fb.category ? (CATEGORY_LABEL[fb.category] ?? fb.category) : "—";
          const busy = busyId === fb.id;
          return (
            <div key={fb.id} className="rounded-lg border border-border bg-card p-3" style={{ boxShadow: "var(--elev-1)" }}>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-semibold text-sm text-foreground">{name}</span>
                <Badge variant="secondary">{categoryLabel}</Badge>
                {fb.app_context && <span className="text-xs text-muted-foreground">{fb.app_context}</span>}
                <span className="ml-auto text-xs text-muted-foreground">{new Date(fb.created_at).toLocaleString()}</span>
              </div>
              <p className="mt-1.5 text-sm text-foreground leading-relaxed">{fb.message}</p>
              <div className="mt-2 flex items-center gap-2">
                <Button
                  variant={fb.handled ? "secondary" : "default"}
                  size="sm"
                  disabled={busy}
                  onClick={() => toggleHandled(fb)}
                >
                  {busy ? "…" : fb.handled ? "Mark unhandled" : <><Check size={13} /> Mark handled</>}
                </Button>
                {fb.handled && fb.handled_at && (
                  <span className="text-xs text-muted-foreground">Handled {new Date(fb.handled_at).toLocaleDateString()}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
