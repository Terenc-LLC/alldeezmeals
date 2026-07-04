import { useState, useEffect, useCallback } from "react";
import { Share2, Copy, CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { CATEGORIES } from "../lib/recipeGenerate.js";
import { s } from "../lib/styles";

type MineResponse =
  | { active: true; url: string; token: string; expires_at: string | null; checked_count: number; total_count: number }
  | { active: false };

function buildSnapshotItems(groceryList: Record<string, Array<{ name: string; qty: number; unit: string }>>) {
  const items: Array<{ name: string; qty: number; unit: string; category: string }> = [];
  for (const cat of CATEGORIES) {
    for (const it of groceryList[cat] ?? []) {
      items.push({ name: it.name, qty: it.qty, unit: it.unit, category: cat });
    }
  }
  return items;
}

export default function ShareListControls({ session, groceryList, totalItems }: any) {
  const [status, setStatus] = useState<MineResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const token = session?.access_token ?? "";

  const fetchMine = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch("/api/shared-list/mine", { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) { setError("Couldn't load share status"); return; }
      const data = (await r.json()) as MineResponse;
      setStatus(data);
      setError(null);
    } catch {
      setError("Couldn't load share status");
    }
  }, [token]);

  useEffect(() => { fetchMine(); }, [fetchMine]);

  const createLink = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/shared-list/create", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ items: buildSnapshotItems(groceryList) }),
      });
      if (!r.ok) { setError("Couldn't create share link"); return; }
      await fetchMine();
    } catch {
      setError("Couldn't create share link");
    } finally {
      setBusy(false);
    }
  };

  const regenerate = () => {
    if (!window.confirm("Generate a new link? The previous link will stop working immediately.")) return;
    createLink();
  };

  const revoke = async () => {
    if (!window.confirm("Revoke this link? It will stop working immediately.")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/shared-list/revoke", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) { setError("Couldn't revoke share link"); return; }
      await fetchMine();
    } catch {
      setError("Couldn't revoke share link");
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!status?.active) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${status.url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  if (!session) return null;

  return (
    <div style={s.lvSunken}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-2)" }}>
        <span style={{ ...s.typeH3, fontSize: 15, color: "var(--c-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Share2 size={15} />
          Share list
        </span>
        {status?.active && (
          <button onClick={fetchMine} disabled={busy} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "grid", color: "var(--c-text-muted)" }} aria-label="Refresh progress">
            <RefreshCw size={14} />
          </button>
        )}
      </div>

      {error && <p style={{ ...s.typeBodySm, color: "var(--c-danger)", margin: "0 0 var(--space-2)" }}>{error}</p>}

      {status === null ? (
        <p style={{ ...s.typeBodySm, color: "var(--c-text-muted)", margin: 0 }}>Loading…</p>
      ) : status.active ? (
        <div>
          <p style={{ ...s.typeBodySm, color: "var(--c-text-muted)", margin: "0 0 var(--space-2)" }}>
            {status.checked_count} of {status.total_count} items checked off
            {status.expires_at && <> · expires {new Date(status.expires_at).toLocaleDateString()}</>}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap" as const, gap: "var(--space-2)" }}>
            <button onClick={copyLink} className="btn-secondary btn--sm">
              {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
              {copied ? "Copied!" : "Copy link"}
            </button>
            <button onClick={regenerate} disabled={busy} className="btn-ghost btn--sm">
              <RefreshCw size={14} /> Regenerate
            </button>
            <button onClick={revoke} disabled={busy} className="btn-ghost btn--sm">
              <XCircle size={14} /> Revoke
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p style={{ ...s.typeBodySm, color: "var(--c-text-muted)", margin: "0 0 var(--space-2)" }}>
            Create a link so someone else can shop this list for you. Expires in 7 days.
          </p>
          <button onClick={createLink} disabled={busy || totalItems === 0} className="btn-secondary btn--sm">
            <Share2 size={14} /> Share list
          </button>
        </div>
      )}
    </div>
  );
}
