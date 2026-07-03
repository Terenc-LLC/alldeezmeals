// TER-286: Public, unauthenticated mobile shopping page rendered at /s/[token].
// Talks ONLY to the two public endpoints via fetch — no Supabase client, no auth,
// no user-state imports. Renders zero account/PII. Read-only except check-off.

import { useEffect, useMemo, useState } from "react";

type SnapshotItem = {
  name: string;
  qty: number;
  unit: string;
  category: string;
};

type Snapshot = { items: SnapshotItem[] };
type CheckState = Record<string, true>;

type Load =
  | { status: "loading" }
  | { status: "ready"; snapshot: Snapshot; checkState: CheckState }
  | { status: "gone" } // 404/410 — friendly "no longer available"
  | { status: "error" }; // unexpected — still non-scary

const s = {
  page: {
    minHeight: "100dvh",
    background: "var(--c-bg)",
    color: "var(--c-text)",
    fontFamily: "inherit",
  } as const,
  container: {
    maxWidth: "560px",
    margin: "0 auto",
    padding: "var(--space-4) var(--space-4) var(--space-8)",
  } as const,
  header: {
    padding: "var(--space-4) 0 var(--space-3)",
  } as const,
  title: {
    fontSize: "var(--t-h1-size)",
    lineHeight: "var(--t-h1-lh)",
    fontWeight: "var(--t-h1-w)" as unknown as number,
    margin: 0,
  } as const,
  progress: {
    fontSize: "var(--t-bodysm-size)",
    lineHeight: "var(--t-bodysm-lh)",
    color: "var(--c-text-muted)",
    marginTop: "var(--space-1)",
  } as const,
  groupHeader: {
    fontSize: "var(--t-label-size)",
    lineHeight: "var(--t-label-lh)",
    fontWeight: "var(--t-label-w)" as unknown as number,
    letterSpacing: "var(--t-label-tracking)",
    textTransform: "uppercase" as const,
    color: "var(--c-text-muted)",
    margin: "var(--space-5) 0 var(--space-2)",
  } as const,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: "var(--space-2)",
  } as const,
  itemBtn: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    width: "100%",
    minHeight: "56px",
    padding: "var(--space-3) var(--space-4)",
    background: "var(--c-surface)",
    border: "1px solid var(--c-border)",
    borderRadius: "var(--radius-md)",
    textAlign: "left" as const,
    cursor: "pointer",
    color: "inherit",
    font: "inherit",
  } as const,
  box: {
    flex: "0 0 auto",
    width: "26px",
    height: "26px",
    borderRadius: "var(--radius-sm)",
    border: "2px solid var(--c-border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "16px",
    lineHeight: 1,
  } as const,
  boxChecked: {
    background: "var(--c-primary)",
    borderColor: "var(--c-primary)",
    color: "var(--c-on-primary)",
  } as const,
  itemBody: { flex: 1, minWidth: 0 } as const,
  name: {
    display: "block",
    fontSize: "var(--t-bodylg-size)",
    lineHeight: "var(--t-bodylg-lh)",
    fontWeight: 600,
  } as const,
  nameChecked: {
    textDecoration: "line-through",
    color: "var(--c-text-muted)",
  } as const,
  meta: {
    display: "block",
    fontSize: "var(--t-bodysm-size)",
    lineHeight: "var(--t-bodysm-lh)",
    color: "var(--c-text-muted)",
    marginTop: "2px",
  } as const,
  center: {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center" as const,
    padding: "var(--space-6)",
    gap: "var(--space-2)",
  } as const,
  centerTitle: {
    fontSize: "var(--t-h2-size)",
    lineHeight: "var(--t-h2-lh)",
    fontWeight: 600,
    margin: 0,
  } as const,
  centerText: {
    fontSize: "var(--t-body-size)",
    lineHeight: "var(--t-body-lh)",
    color: "var(--c-text-muted)",
    margin: 0,
    maxWidth: "34ch",
  } as const,
};

function itemMeta(it: SnapshotItem): string {
  const qty = it.qty ? String(it.qty) : "";
  const parts = [qty, it.unit].filter(Boolean).join(" ").trim();
  return parts;
}

export default function SharedListPage({ token }: { token: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  // Track in-flight indices so rapid taps don't clobber; not strictly required
  // under Option A but keeps optimistic UI honest.
  const [pending, setPending] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/shared-list/${encodeURIComponent(token)}`);
        if (res.status === 404 || res.status === 410) {
          if (!cancelled) setLoad({ status: "gone" });
          return;
        }
        if (!res.ok) {
          if (!cancelled) setLoad({ status: "error" });
          return;
        }
        const json = await res.json();
        const snapshot: Snapshot = json.snapshot ?? { items: [] };
        const checkState: CheckState = json.check_state ?? {};
        if (!cancelled) setLoad({ status: "ready", snapshot, checkState });
      } catch {
        if (!cancelled) setLoad({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const groups = useMemo(() => {
    if (load.status !== "ready") return [] as { category: string; items: { it: SnapshotItem; index: number }[] }[];
    const byCat = new Map<string, { it: SnapshotItem; index: number }[]>();
    load.snapshot.items.forEach((it, index) => {
      const cat = it.category?.trim() || "Other";
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push({ it, index });
    });
    return Array.from(byCat.entries()).map(([category, items]) => ({ category, items }));
  }, [load]);

  const counts = useMemo(() => {
    if (load.status !== "ready") return { done: 0, total: 0 };
    const total = load.snapshot.items.length;
    const done = load.snapshot.items.reduce((n, _it, i) => (load.checkState[String(i)] ? n + 1 : n), 0);
    return { done, total };
  }, [load]);

  async function toggle(index: number, next: boolean) {
    if (load.status !== "ready") return;
    if (pending.has(index)) return;

    const prev = load.checkState;
    const optimistic: CheckState = { ...prev };
    if (next) optimistic[String(index)] = true;
    else delete optimistic[String(index)];

    setLoad({ status: "ready", snapshot: load.snapshot, checkState: optimistic });
    setPending((p) => new Set(p).add(index));

    try {
      const res = await fetch(`/api/shared-list/${encodeURIComponent(token)}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, checked: next }),
      });
      if (res.status === 404 || res.status === 410) {
        setLoad({ status: "gone" });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      const serverState: CheckState = json.check_state ?? optimistic;
      setLoad((cur) =>
        cur.status === "ready" ? { status: "ready", snapshot: cur.snapshot, checkState: serverState } : cur
      );
    } catch {
      // Roll back to the pre-toggle state.
      setLoad((cur) => (cur.status === "ready" ? { status: "ready", snapshot: cur.snapshot, checkState: prev } : cur));
    } finally {
      setPending((p) => {
        const nextSet = new Set(p);
        nextSet.delete(index);
        return nextSet;
      });
    }
  }

  if (load.status === "loading") {
    return (
      <div style={s.center}>
        <p style={s.centerText}>Loading your list…</p>
      </div>
    );
  }

  if (load.status === "gone") {
    return (
      <div style={s.center}>
        <div style={{ fontSize: "40px" }}>🧺</div>
        <h1 style={s.centerTitle}>This list is no longer available</h1>
        <p style={s.centerText}>
          The share link may have expired or been turned off. Ask whoever sent it to share a fresh one.
        </p>
      </div>
    );
  }

  if (load.status === "error") {
    return (
      <div style={s.center}>
        <div style={{ fontSize: "40px" }}>🛒</div>
        <h1 style={s.centerTitle}>Can’t load the list right now</h1>
        <p style={s.centerText}>Something went wrong reaching the list. Check your connection and try again.</p>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.container}>
        <header style={s.header}>
          <h1 style={s.title}>Shopping list</h1>
          <div style={s.progress}>
            {counts.done} of {counts.total} checked off
          </div>
        </header>

        {groups.map((group) => (
          <section key={group.category}>
            <h2 style={s.groupHeader}>{group.category}</h2>
            <ul style={s.list}>
              {group.items.map(({ it, index }) => {
                const checked = !!load.checkState[String(index)];
                const meta = itemMeta(it);
                return (
                  <li key={index}>
                    <button
                      type="button"
                      style={s.itemBtn}
                      aria-pressed={checked}
                      onClick={() => toggle(index, !checked)}
                    >
                      <span style={{ ...s.box, ...(checked ? s.boxChecked : null) }} aria-hidden="true">
                        {checked ? "✓" : ""}
                      </span>
                      <span style={s.itemBody}>
                        <span style={{ ...s.name, ...(checked ? s.nameChecked : null) }}>{it.name}</span>
                        {meta ? <span style={s.meta}>{meta}</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
