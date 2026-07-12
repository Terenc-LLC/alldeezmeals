import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ShieldCheck, ListChecks, Receipt, MessageSquare } from "lucide-react";

type DashboardData = {
  attention: {
    pendingUsers: number;
    pendingRecipes: number;
    pendingSubmissions: number;
    unhandledFeedback: number;
  };
  headline: {
    wau: number;
    approvedUsers: number;
    qualified: number;
    qualifiedCap: number;
    generationsThisWeek: number;
    costThisWeekUsd: number;
  };
};

// TER-515: "what needs my attention + how's it going" at a glance. Pure
// aggregation over GET /api/dashboard — no client-side computation of counts.
export default function Dashboard({ session }: { session: any }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const token = session?.access_token ?? "";

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch("/api/dashboard", { headers: { authorization: `Bearer ${token}` } })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `Error ${r.status}`);
        if (!cancelled) setData(d);
      })
      .catch((e) => { if (!cancelled) setError(e?.message ?? "Failed to load dashboard."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading dashboard…</p>;
  }

  if (error) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-destructive">
        <AlertCircle size={14} /> {error}
      </p>
    );
  }

  if (!data) return null;

  const attentionTiles = [
    {
      label: "Pending users",
      value: data.attention.pendingUsers,
      to: "/approvals",
      icon: ShieldCheck,
    },
    {
      label: "Pending recipes",
      value: data.attention.pendingRecipes,
      to: "/review-queues",
      icon: ListChecks,
    },
    {
      label: "Pending submissions",
      value: data.attention.pendingSubmissions,
      to: "/review-queues",
      icon: Receipt,
    },
    {
      label: "Unhandled feedback",
      value: data.attention.unhandledFeedback,
      to: "/feedback",
      icon: MessageSquare,
    },
  ];

  const costThisWeek = data.headline.costThisWeekUsd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const headlineTiles = [
    { label: "Weekly active users", value: data.headline.wau, to: "/users" },
    { label: "Approved users", value: data.headline.approvedUsers, to: "/users" },
    {
      label: "Qualification progress",
      value: `${data.headline.qualified}/${data.headline.qualifiedCap}`,
      to: "/beta",
    },
    { label: "Generations this week", value: data.headline.generationsThisWeek, to: "/insights" },
    { label: "API cost this week", value: costThisWeek, to: "/insights" },
    { label: "Activation funnel", value: "Coming soon", to: "/insights" },
  ];

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-1 text-base font-semibold text-foreground">Needs your attention</h2>
        <p className="mb-4 text-sm text-muted-foreground">Open queues, ranked by what's waiting on you.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {attentionTiles.map(({ label, value, to, icon: Icon }) => (
            <Link
              key={label}
              to={to}
              className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
              style={{ boxShadow: "var(--elev-1)" }}
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Icon size={14} />
                {label}
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-base font-semibold text-foreground">How it's going</h2>
        <p className="mb-4 text-sm text-muted-foreground">Headline metrics for the current week.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {headlineTiles.map(({ label, value, to }) => (
            <Link
              key={label}
              to={to}
              className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
              style={{ boxShadow: "var(--elev-1)" }}
            >
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
