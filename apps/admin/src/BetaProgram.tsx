import { useEffect, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import type { QualifiedUser } from "@/lib/types";

const CAP = 50;

// TER-514: ports the qualified-users progress panel + admin-grant form out of
// the old CatalogView.tsx (deleted in TER-510) — GET /api/list-qualified and
// POST /api/grant-qualification are unchanged (list-qualified now also
// surfaces referral signal from profiles.referral_code/referred_by).
export default function BetaProgram({ session }: { session: any }) {
  const [users, setUsers] = useState<QualifiedUser[] | null>(null);
  const [counter, setCounter] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [grantEmail, setGrantEmail] = useState("");
  const [granting, setGranting] = useState(false);
  const [grantResult, setGrantResult] = useState<string | null>(null);

  const token = session?.access_token ?? "";

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/list-qualified", { headers: { authorization: `Bearer ${token}` } });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      setUsers(data.users ?? []);
      setCounter(data.counter ?? 0);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load qualified users.");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleGrant = async () => {
    const email = grantEmail.trim();
    if (!email) return;
    setGranting(true);
    setGrantResult(null);
    try {
      const r = await fetch("/api/grant-qualification", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ email }),
      });
      const d = await r.json();
      if (!r.ok) {
        setGrantResult(d.error ?? `Error ${r.status}`);
      } else if (d.alreadyQualified) {
        setGrantResult(`Already qualified — #${d.number} of ${CAP}`);
      } else if (d.capReached) {
        setGrantResult(`Cap reached (${CAP} of ${CAP})`);
      } else {
        setGrantResult(`Qualified! #${d.number} of ${CAP}`);
        setGrantEmail("");
        await load();
      }
    } catch (e: any) {
      setGrantResult(e?.message ?? "Unknown error");
    }
    setGranting(false);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading beta program…</p>;
  }

  if (error) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-destructive">
        <AlertCircle size={14} /> {error}
      </p>
    );
  }

  const list = users ?? [];
  const pct = Math.min(100, Math.round((counter / CAP) * 100));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">
          Qualified: {counter} / {CAP}
        </h2>
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </Button>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4" style={{ boxShadow: "var(--elev-1)" }}>
        <label className="text-xs text-muted-foreground">Grant qualification by email</label>
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="user@example.com"
            value={grantEmail}
            onChange={(e) => { setGrantEmail(e.target.value); setGrantResult(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleGrant(); }}
            className="flex-1"
          />
          <Button onClick={handleGrant} disabled={granting || !grantEmail.trim()}>
            {granting ? "…" : "Mark qualified"}
          </Button>
        </div>
        {grantResult && <p className="text-sm text-muted-foreground">{grantResult}</p>}
      </div>

      {list.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No qualified users yet.</p>}

      {list.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Qualified</TableHead>
              <TableHead>Referrals</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((u) => (
              <TableRow key={u.qualification_number}>
                <TableCell>
                  <Badge variant="success">#{u.qualification_number}</Badge>
                </TableCell>
                <TableCell className="font-medium text-foreground">{u.name ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{u.email ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(u.qualified_at)}</TableCell>
                <TableCell>
                  {u.referred_signups > 0 ? (
                    <Badge variant="outline">{u.referred_signups} invited</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
