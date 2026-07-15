import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { LIFECYCLE_LABELS, LIFECYCLE_STATES, classifyLifecycle, type LifecycleState } from "@/lib/lifecycle";
import type { AdminUser } from "@/lib/types";

type InsightsUserRow = AdminUser & { lifecycle: LifecycleState };

// Mirrors the hues behind LIFECYCLE_BADGE_CLASSES (sky/violet/emerald/amber/zinc
// 500) so the chart and the Users directory badges read as one palette.
const SEGMENT_COLORS: Record<LifecycleState, string> = {
  new: "#0ea5e9",
  activated: "#8b5cf6",
  engaged: "#10b981",
  at_risk: "#f59e0b",
  churned: "#71717a",
};

// TER-517: replaces the /insights placeholder with the lifecycle segment view
// (2 of 2, independent of the TER-516 funnel). Classification and data source
// are reused as-is from TER-511 (classifyLifecycle, GET /api/users) — this is a
// rendering-only consumer, no new endpoint and no rule changes.
export default function Insights({ session }: { session: any }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeSegment, setActiveSegment] = useState<LifecycleState>("new");

  const token = session?.access_token ?? "";

  const load = () => {
    setLoading(true);
    setError("");
    fetch("/api/users", { headers: { authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
        setUsers(data.users ?? []);
      })
      .catch((e: any) => setError(e?.message ?? "Failed to load users."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const rows = useMemo<InsightsUserRow[]>(
    () => (users ?? []).map((u) => ({ ...u, lifecycle: classifyLifecycle(u) })),
    [users]
  );

  const distribution = useMemo(
    () =>
      LIFECYCLE_STATES.map((state) => ({
        state,
        label: LIFECYCLE_LABELS[state],
        count: rows.filter((u) => u.lifecycle === state).length,
      })),
    [rows]
  );

  const segmentMembers = useMemo(
    () =>
      rows
        .filter((u) => u.lifecycle === activeSegment)
        .sort((a, b) => (b.last_active ?? "").localeCompare(a.last_active ?? "")),
    [rows, activeSegment]
  );

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading insights…</p>;
  }

  if (error) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-destructive">
        <AlertCircle size={14} /> {error}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Slot for the TER-516 activation funnel (1 of 2, still Backlog). */}
      <section className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        Activation funnel (TER-516) slots in here.
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">User lifecycle</h2>
            <p className="text-sm text-muted-foreground">
              {rows.length} user{rows.length === 1 ? "" : "s"} across five engagement segments.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw size={13} /> Refresh
          </Button>
        </div>

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No users yet.</p>
        ) : (
          <div className="rounded-lg border border-border bg-card p-4" style={{ boxShadow: "var(--elev-1)" }}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={distribution} barCategoryGap="30%">
                <CartesianGrid vertical={false} strokeOpacity={0.15} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} width={32} />
                <Tooltip
                  cursor={{ fill: "var(--c-surface-2)" }}
                  formatter={(value: number) => [`${value} user${value === 1 ? "" : "s"}`, "Count"]}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {distribution.map((d) => (
                    <Cell key={d.state} fill={SEGMENT_COLORS[d.state]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {LIFECYCLE_STATES.map((state) => (
              <Button
                key={state}
                variant={activeSegment === state ? "default" : "secondary"}
                size="sm"
                onClick={() => setActiveSegment(state)}
              >
                {LIFECYCLE_LABELS[state]} ({distribution.find((d) => d.state === state)?.count ?? 0})
              </Button>
            ))}
          </div>
          <Link to={`/users?lifecycle=${activeSegment}`} className="text-sm font-medium text-primary hover:underline">
            View in directory →
          </Link>
        </div>

        {segmentMembers.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No users in this segment.</p>
        ) : (
          <div className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {segmentMembers.map((u) => (
              <Link
                key={u.id}
                to={`/users?lifecycle=${activeSegment}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm transition-colors hover:bg-secondary/50"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {[u.first_name, u.last_name].filter(Boolean).join(" ") || u.email}
                  </p>
                  <p className="truncate text-muted-foreground">{u.email}</p>
                </div>
                <div className="flex shrink-0 gap-4 text-muted-foreground">
                  <span>Last active {formatDate(u.last_active)}</span>
                  <span className="tabular-nums">{u.recipes_generated} plans</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
