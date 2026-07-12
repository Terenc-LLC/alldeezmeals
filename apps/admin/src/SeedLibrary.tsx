import { useState } from "react";
import { Button } from "@/components/ui/button";

type SeedLogEntry = { target: string; ok: boolean; reason?: string };

// TER-358/TER-514: ports the seed-library tool out of the old CatalogView.tsx
// (deleted in TER-510). Previously ran client-side against /api/generate +
// /api/recipes (consumer app endpoints); now calls the self-contained
// POST /api/seed-recipe (apps/admin/api) one target at a time — avoids a
// cross-origin call into the separately-deployed consumer project.
export default function SeedLibrary({ session }: { session: any }) {
  const [targetsText, setTargetsText] = useState("");
  const [seedCount, setSeedCount] = useState(5);
  const [seeding, setSeeding] = useState(false);
  const [log, setLog] = useState<SeedLogEntry[]>([]);

  const token = session?.access_token ?? "";
  const allTargets = targetsText.split("\n").map((l) => l.trim()).filter(Boolean);

  const handleSeed = async () => {
    const targets = allTargets.slice(0, seedCount);
    if (!targets.length) return;
    setSeeding(true);
    setLog([]);
    for (const target of targets) {
      try {
        const r = await fetch("/api/seed-recipe", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ target, servings: 4 }),
        });
        const d = await r.json();
        if (r.status === 422) {
          setLog((l) => [...l, { target, ok: false, reason: `hard fail: ${d.hardFailures?.[0] ?? ""}` }]);
        } else if (r.ok && d.saved === false) {
          setLog((l) => [...l, { target, ok: false, reason: `soft fail: ${d.softFailures?.[0] ?? ""}` }]);
        } else if (!r.ok) {
          setLog((l) => [...l, { target, ok: false, reason: d.reason ?? d.error ?? `HTTP ${r.status}` }]);
        } else {
          setLog((l) => [...l, { target, ok: true }]);
        }
      } catch (e: any) {
        setLog((l) => [...l, { target, ok: false, reason: e?.message ?? "error" }]);
      }
    }
    setSeeding(false);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4" style={{ boxShadow: "var(--elev-1)" }}>
      <h3 className="text-sm font-semibold text-foreground">Seed library</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Dish targets — one per line (e.g. "Italian – Tuscan white-bean skillet"). Generated recipes land pending review.
      </p>
      <textarea
        value={targetsText}
        onChange={(e) => setTargetsText(e.target.value)}
        rows={6}
        placeholder={"Italian – Tuscan white-bean and sausage skillet\nMexican – Chicken enchiladas verde\nAsian – Beef and broccoli stir-fry"}
        className="mt-2 w-full resize-y rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <label>Generate up to</label>
        <input
          type="number"
          min={1}
          max={20}
          value={seedCount}
          onChange={(e) => setSeedCount(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
          className="h-9 w-16 rounded-md border border-border bg-card px-2 text-sm text-foreground"
        />
        <span>of {allTargets.length} targets · servings=4 · lands pending</span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={handleSeed} disabled={seeding || !allTargets.length}>
          {seeding ? "Seeding…" : `Seed ${Math.min(seedCount, allTargets.length)} recipe(s)`}
        </Button>
        {log.length > 0 && !seeding && (
          <span className="text-sm text-muted-foreground">
            {log.filter((r) => r.ok).length} saved · {log.filter((r) => !r.ok).length} skipped/failed
          </span>
        )}
      </div>
      {log.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {log.map((r, i) => (
            <div key={i} className={`flex gap-1.5 text-xs ${r.ok ? "text-primary" : "text-muted-foreground"}`}>
              <span className="font-bold">{r.ok ? "✓" : "✗"}</span>
              <span>
                {r.target}
                {r.reason ? ` — ${r.reason}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
