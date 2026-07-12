import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type BackfillResult = { ok: boolean; dryRun: boolean; scanned: number; deactivated: number; byRule: Record<string, number> };

// TER-336/TER-514: UI for the existing POST /api/admin-recipe-backfill endpoint
// (scans active recipe_library rows, deactivates hard-invalid ones via the
// shared validator). Never had a frontend before this port — dry-run first is
// the default flow.
export default function RecipeBackfill({ session }: { session: any }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BackfillResult | null>(null);

  const token = session?.access_token ?? "";

  const run = async (dryRun: boolean) => {
    if (!dryRun && !window.confirm("Deactivate all hard-invalid recipe_library rows? This cannot be undone.")) return;
    setRunning(true);
    setError("");
    try {
      const r = await fetch("/api/admin-recipe-backfill", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ dryRun }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      setResult(data);
    } catch (e: any) {
      setError(e?.message ?? "Backfill failed.");
    }
    setRunning(false);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4" style={{ boxShadow: "var(--elev-1)" }}>
      <h3 className="text-sm font-semibold text-foreground">Recipe library backfill</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Scans active recipe_library rows and deactivates any that fail hard validation. Dry run reports without writing.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="secondary" disabled={running} onClick={() => run(true)}>
          {running ? "…" : "Dry run"}
        </Button>
        <Button variant="destructive" disabled={running} onClick={() => run(false)}>
          {running ? "…" : "Run backfill"}
        </Button>
      </div>

      {error && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle size={14} /> {error}
        </p>
      )}

      {result && (
        <div className="mt-3 flex flex-col gap-1 text-sm text-foreground">
          <p>
            {result.dryRun ? "Dry run" : "Backfill"} scanned <span className="font-semibold">{result.scanned}</span>, deactivated{" "}
            <span className="font-semibold">{result.deactivated}</span>.
          </p>
          {Object.keys(result.byRule).length > 0 && (
            <ul className="list-disc pl-5 text-xs text-muted-foreground">
              {Object.entries(result.byRule).map(([rule, count]) => (
                <li key={rule}>
                  {rule}: {count}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
