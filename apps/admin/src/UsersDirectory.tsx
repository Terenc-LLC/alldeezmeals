import { useEffect, useMemo, useState } from "react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpDown, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import {
  LIFECYCLE_BADGE_CLASSES,
  LIFECYCLE_LABELS,
  LIFECYCLE_STATES,
  classifyLifecycle,
  type LifecycleState,
} from "@/lib/lifecycle";
import type { AdminUser, FeedbackItem } from "@/lib/types";
import UserDrillDownPanel from "./UserDrillDownPanel";

type StatusFilter = "all" | "pending" | "approved" | "qualified";
type AdminUserRow = AdminUser & { lifecycle: LifecycleState };

// TER-511: full users directory on TanStack Table — sort, filter, text search,
// lifecycle classification, and a per-user drill-down. Ports the TER-368/499
// user table (previously CatalogView.tsx in the consumer app, deleted in TER-510).
// GET /api/users already carries everything this needs — no new endpoint.
export default function UsersDirectory({ session }: { session: any }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<"all" | LifecycleState>("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "created_at", desc: true }]);
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const [feedback, setFeedback] = useState<FeedbackItem[] | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  const token = session?.access_token ?? "";

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/users", { headers: { authorization: `Bearer ${token}` } });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      setUsers(data.users ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load users.");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadFeedback = () => {
    if (feedback !== null || feedbackLoading) return; // fetch once, cache
    setFeedbackLoading(true);
    fetch("/api/list-feedback", { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : { feedback: [] }))
      .then((data) => setFeedback(data.feedback ?? []))
      .catch(() => setFeedback([]))
      .finally(() => setFeedbackLoading(false));
  };

  const openDrillDown = (userId: string) => {
    setSelectedUserId(userId);
    loadFeedback();
  };

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
      setUsers((p) => (p ?? []).map((u) => (u.id === userId ? { ...u, approved: true } : u)));
    } catch (e: any) {
      setRowError((p) => ({ ...p, [userId]: e?.message ?? "Approve failed." }));
    }
    setBusyId(null);
  };

  const handleReject = async (userId: string, email: string) => {
    if (!window.confirm(`Reject and delete ${email}? This cannot be undone.`)) return;
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

  const handleGrantQual = async (userId: string, email: string) => {
    setBusyId(userId);
    setRowError((p) => ({ ...p, [userId]: "" }));
    try {
      const r = await fetch("/api/grant-qualification", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ email }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      if (data.capReached) {
        setRowError((p) => ({ ...p, [userId]: "Cap reached (50 of 50)" }));
      } else {
        setUsers((p) =>
          (p ?? []).map((u) =>
            u.id === userId ? { ...u, qualified: true, qualification_slot: data.number ?? u.qualification_slot } : u
          )
        );
      }
    } catch (e: any) {
      setRowError((p) => ({ ...p, [userId]: e?.message ?? "Grant failed." }));
    }
    setBusyId(null);
  };

  const allRows = useMemo<AdminUserRow[]>(
    () => (users ?? []).map((u) => ({ ...u, lifecycle: classifyLifecycle(u) })),
    [users]
  );

  const filteredRows = useMemo(
    () =>
      allRows
        .filter((u) => {
          if (statusFilter === "pending") return !u.approved;
          if (statusFilter === "approved") return u.approved;
          if (statusFilter === "qualified") return u.qualified;
          return true;
        })
        .filter((u) => lifecycleFilter === "all" || u.lifecycle === lifecycleFilter),
    [allRows, statusFilter, lifecycleFilter]
  );

  const selectedUser = allRows.find((u) => u.id === selectedUserId) ?? null;

  const columns = useMemo<ColumnDef<AdminUserRow>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        accessorFn: (u) => [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email,
        cell: (info) => <span className="font-medium text-foreground">{info.getValue() as string}</span>,
      },
      {
        accessorKey: "email",
        header: "Email",
        cell: (info) => <span className="text-muted-foreground">{info.getValue() as string}</span>,
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (u) => (u.approved ? "approved" : "pending"),
        cell: ({ row }) => (
          <Badge variant={row.original.approved ? "success" : "warning"}>
            {row.original.approved ? "Approved" : "Pending"}
          </Badge>
        ),
      },
      {
        accessorKey: "lifecycle",
        header: "Lifecycle",
        cell: ({ getValue }) => {
          const state = getValue() as LifecycleState;
          return <Badge className={LIFECYCLE_BADGE_CLASSES[state]}>{LIFECYCLE_LABELS[state]}</Badge>;
        },
      },
      {
        id: "qualified",
        header: "Qualified",
        accessorFn: (u) => u.qualification_slot ?? -1,
        cell: ({ row }) =>
          row.original.qualified ? (
            <Badge variant="success">#{row.original.qualification_slot}</Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "created_at",
        header: "Signed up",
        cell: (info) => formatDate(info.getValue() as string),
      },
      {
        accessorKey: "last_active",
        header: "Last active",
        cell: (info) => formatDate(info.getValue() as string | null),
      },
      {
        accessorKey: "recipes_generated",
        header: "Recipes generated",
        cell: (info) => <span className="tabular-nums">{info.getValue() as number}</span>,
      },
      {
        accessorKey: "dinners_accepted",
        header: "Dinners accepted",
        cell: (info) => <span className="tabular-nums">{info.getValue() as number}</span>,
      },
      {
        id: "accept_rate",
        header: "Accept rate",
        accessorFn: (u) => (u.recipes_generated > 0 ? u.dinners_accepted / u.recipes_generated : -1),
        cell: ({ row }) => {
          const u = row.original;
          return (
            <span className="tabular-nums">
              {u.recipes_generated > 0 ? `${Math.round((u.dinners_accepted / u.recipes_generated) * 100)}%` : "—"}
            </span>
          );
        },
      },
      {
        accessorKey: "feedback_count",
        header: "Feedback",
        cell: (info) => <span className="tabular-nums">{info.getValue() as number}</span>,
      },
      {
        accessorKey: "signup_source",
        header: "Source",
        cell: (info) => (info.getValue() as string | null) ?? "—",
      },
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        cell: ({ row }) => {
          const u = row.original;
          const busy = busyId === u.id;
          const err = rowError[u.id];
          return (
            <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
              <div className="flex gap-1.5">
                {!u.approved && (
                  <>
                    <Button size="sm" disabled={busy} onClick={() => handleApprove(u.id)}>
                      {busy ? "…" : "Approve"}
                    </Button>
                    <Button size="sm" variant="destructive" disabled={busy} onClick={() => handleReject(u.id, u.email)}>
                      Reject
                    </Button>
                  </>
                )}
                {u.approved && !u.qualified && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => handleGrantQual(u.id, u.email)}>
                    {busy ? "…" : "Grant qual"}
                  </Button>
                )}
              </div>
              {err && <span className="text-xs text-destructive">{err}</span>}
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busyId, rowError]
  );

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    globalFilterFn: (row, _columnId, filterValue) => {
      const q = String(filterValue).toLowerCase().trim();
      if (!q) return true;
      const u = row.original;
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ").toLowerCase();
      return name.includes(q) || u.email.toLowerCase().includes(q);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading users…</p>;
  }

  if (error) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-destructive">
        <AlertCircle size={14} /> {error}
      </p>
    );
  }

  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">
          Users ({rows.length}
          {rows.length !== (users?.length ?? 0) ? ` of ${users?.length ?? 0}` : ""})
        </h2>
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "pending", "approved", "qualified"] as const).map((f) => (
          <Button
            key={f}
            variant={statusFilter === f ? "default" : "secondary"}
            size="sm"
            onClick={() => setStatusFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
        <select
          value={lifecycleFilter}
          onChange={(e) => setLifecycleFilter(e.target.value as "all" | LifecycleState)}
          className="h-9 rounded-md border border-border bg-card px-2 text-sm text-foreground"
        >
          <option value="all">All lifecycle states</option>
          {LIFECYCLE_STATES.map((s) => (
            <option key={s} value={s}>
              {LIFECYCLE_LABELS[s]}
            </option>
          ))}
        </select>
        <div className="relative ml-auto w-full max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="pl-8"
          />
        </div>
      </div>

      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((header) => {
                const sortable = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                return (
                  <TableHead
                    key={header.id}
                    onClick={sortable ? header.column.getToggleSortingHandler() : undefined}
                    className={sortable ? "cursor-pointer select-none" : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sortable &&
                        (sorted === "asc" ? (
                          <ArrowUp size={12} />
                        ) : sorted === "desc" ? (
                          <ArrowDown size={12} />
                        ) : (
                          <ArrowUpDown size={12} className="opacity-40" />
                        ))}
                    </span>
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} className="cursor-pointer" onClick={() => openDrillDown(row.original.id)}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No users match these filters.</p>}

      {selectedUser && (
        <UserDrillDownPanel
          user={selectedUser}
          feedback={(feedback ?? []).filter((f) => f.user_id === selectedUser.id)}
          feedbackLoading={feedbackLoading}
          busy={busyId === selectedUser.id}
          onClose={() => setSelectedUserId(null)}
          onApprove={handleApprove}
          onReject={handleReject}
          onGrantQual={handleGrantQual}
        />
      )}
    </div>
  );
}
