import { useEffect, useState } from "react";
import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import type { PendingSubmission } from "@/lib/types";

// TER-512: receipt-submission review queue — expandable rows, approve (writes
// to shared catalog + backfills item_usage) or reject with an optional reason.
// Ports the TER-237 queue out of the old CatalogView (deleted in TER-510).
export default function SubmissionReviewQueue({ session }: { session: any }) {
  const [submissions, setSubmissions] = useState<PendingSubmission[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const token = session?.access_token ?? "";

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/list-submissions", {
        headers: { authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      setSubmissions(data.submissions ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load pending submissions.");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleApprove = async (id: string) => {
    if (!window.confirm("Approve this submission? Its items will be written to the shared catalog.")) return;
    setBusyId(id);
    setRowError((p) => ({ ...p, [id]: "" }));
    try {
      const r = await fetch("/api/approve-submission", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ submissionId: id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      setSubmissions((p) => (p ?? []).filter((s) => s.id !== id));
    } catch (e: any) {
      setRowError((p) => ({ ...p, [id]: e?.message ?? "Approve failed." }));
    }
    setBusyId(null);
  };

  const handleReject = async (id: string) => {
    setBusyId(id);
    setRowError((p) => ({ ...p, [id]: "" }));
    try {
      const r = await fetch("/api/reject-submission", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ submissionId: id, reason: rejectReason || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      setRejectingId(null);
      setRejectReason("");
      setSubmissions((p) => (p ?? []).filter((s) => s.id !== id));
    } catch (e: any) {
      setRowError((p) => ({ ...p, [id]: e?.message ?? "Reject failed." }));
    }
    setBusyId(null);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading pending submissions…</p>;
  }

  if (error) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-destructive">
        <AlertCircle size={14} /> {error}
      </p>
    );
  }

  const list = submissions ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">Pending submissions ({list.length})</h2>
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </Button>
      </div>

      {list.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <Inbox size={28} />
          <p className="text-sm">No pending submissions</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {list.map((sub) => {
          const busy = busyId === sub.id;
          const expanded = expandedId === sub.id;
          const rejecting = rejectingId === sub.id;
          return (
            <div key={sub.id} className="rounded-lg border border-border bg-card p-4" style={{ boxShadow: "var(--elev-1)" }}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">{sub.submitter_email ?? "unknown"}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {sub.order_date ?? "no date"} · {sub.rows.length} items
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatDate(sub.created_at)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setExpandedId(expanded ? null : sub.id)}>
                    {expanded ? "Hide" : "View"}
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => handleApprove(sub.id)}>
                    {busy && !rejecting ? "…" : "Approve"}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setRejectingId(rejecting ? null : sub.id);
                      setRejectReason("");
                    }}
                  >
                    Reject
                  </Button>
                </div>
              </div>

              {expanded && (
                <div className="mt-3 max-h-56 overflow-y-auto border-t border-border pt-3 text-sm text-muted-foreground">
                  {sub.rows.map((r, i) => (
                    <div key={i} className="border-b border-border py-1.5 last:border-0">
                      <span className="font-medium text-foreground">{r.productName || r.normalizedProduct}</span>
                      {r.brand && <span> · {r.brand}</span>}
                      {r.category && <span> · {r.category}</span>}
                      {r.packageSize && <span> · {r.packageSize}</span>}
                      {r.unitPriceCents != null && <span> · ${(r.unitPriceCents / 100).toFixed(2)}</span>}
                    </div>
                  ))}
                </div>
              )}

              {rowError[sub.id] && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-destructive">
                  <AlertCircle size={14} /> {rowError[sub.id]}
                </p>
              )}

              {rejecting && (
                <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                  <label className="text-xs text-muted-foreground">Reject reason (optional)</label>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={2}
                    placeholder="Optional explanation…"
                    className="w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
                  />
                  <div className="flex gap-2">
                    <Button variant="destructive" size="sm" disabled={busy} onClick={() => handleReject(sub.id)}>
                      {busy ? "…" : "Confirm reject"}
                    </Button>
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => setRejectingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
