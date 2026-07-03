import { useEffect, useState } from "react";
import { AlertCircle, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";

type PendingUser = {
  id: string;
  email: string;
  name: string | null;
  nearest_aldi: string | null;
  reason: string | null;
  requested_at: string;
};

// TER-508: mobile-first pending-user approval queue — the deliberate responsive
// exception in the otherwise desktop-first admin app. Card list, not a table.
export default function Approvals({ session }: { session: any }) {
  const [users, setUsers] = useState<PendingUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const token = session?.access_token ?? "";

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/list-pending-users", {
        headers: { authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      setUsers(data.users ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load pending users.");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleApprove = async (userId: string) => {
    setBusyId(userId);
    setRowError((p) => ({ ...p, [userId]: "" }));
    try {
      const r = await fetch("/api/approve-user", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      setUsers((p) => (p ?? []).filter((u) => u.id !== userId));
    } catch (e: any) {
      setRowError((p) => ({ ...p, [userId]: e?.message ?? "Approve failed." }));
    }
    setBusyId(null);
  };

  const handleReject = async (userId: string) => {
    setConfirmRejectId(null);
    setBusyId(userId);
    setRowError((p) => ({ ...p, [userId]: "" }));
    try {
      const r = await fetch("/api/reject-user", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      setUsers((p) => (p ?? []).filter((u) => u.id !== userId));
    } catch (e: any) {
      setRowError((p) => ({ ...p, [userId]: e?.message ?? "Reject failed." }));
    }
    setBusyId(null);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading pending users…</p>;
  }

  if (error) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-destructive">
        <AlertCircle size={14} /> {error}
      </p>
    );
  }

  if (!users || users.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
        <Inbox size={28} />
        <p className="text-sm">No pending users</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {users.map((u) => {
        const busy = busyId === u.id;
        const confirming = confirmRejectId === u.id;
        return (
          <div
            key={u.id}
            className="rounded-lg border border-border bg-card p-4"
            style={{ boxShadow: "var(--elev-1)" }}
          >
            <p className="font-semibold text-foreground">{u.name || u.email}</p>
            {u.name && <p className="text-sm text-muted-foreground">{u.email}</p>}
            {u.nearest_aldi && (
              <p className="mt-2 text-sm text-foreground">
                <span className="text-muted-foreground">Nearest ALDI: </span>
                {u.nearest_aldi}
              </p>
            )}
            {u.reason && (
              <p className="mt-1 text-sm text-foreground">
                <span className="text-muted-foreground">Reason: </span>
                {u.reason}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Requested {new Date(u.requested_at).toLocaleString()}
            </p>

            {rowError[u.id] && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-destructive">
                <AlertCircle size={14} /> {rowError[u.id]}
              </p>
            )}

            {confirming ? (
              <div className="mt-3 flex flex-col gap-2">
                <p className="text-sm text-destructive">
                  Reject and delete {u.email}? This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    className="flex-1"
                    disabled={busy}
                    onClick={() => handleReject(u.id)}
                  >
                    {busy ? "Rejecting…" : "Confirm reject"}
                  </Button>
                  <Button
                    variant="secondary"
                    className="flex-1"
                    disabled={busy}
                    onClick={() => setConfirmRejectId(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                <Button
                  className="flex-1"
                  disabled={busy}
                  onClick={() => handleApprove(u.id)}
                >
                  {busy ? "Approving…" : "Approve"}
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => setConfirmRejectId(u.id)}
                >
                  Reject
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
