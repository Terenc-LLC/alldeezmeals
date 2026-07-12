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
import { supabase } from "@terenc/shared/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import type { CatalogItem } from "@/lib/types";
import CatalogDrillDownPanel from "./CatalogDrillDownPanel";

const CATALOG_COLUMNS =
  "id, product_name, normalized_product, package_size, category, upc, kcal_per_100g, serving_g, macros, fdc_id, nutrition_source, nutrition_retrieved_at, nutrition_stale, updated_at";

type ManualVals = { kcal: string; serving_g: string; protein: string; fat: string; carbs: string };
type ActionResult = { ok: boolean; msg: string };

// TER-513: catalog browse/edit/nutrition on TanStack Table. Ports the catalog
// section of the old CatalogView.tsx (deleted in TER-510) — search, expand-to-edit
// (now a drill-down panel), USDA/OFF nutrition fetch by UPC, and manual save.
// The `catalog` table has an RLS policy allowing any authenticated user to SELECT
// (see migration 20260525_002), so this reads directly via the shared supabase
// client, same as the original — writes go through the admin-gated endpoints.
export default function CatalogDirectory({ session }: { session: any }) {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "updated_at", desc: true }]);
  const [search, setSearch] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<Record<string, ActionResult>>({});

  const token = session?.access_token ?? "";

  const load = async () => {
    setLoading(true);
    setError("");
    const { data, error: selErr } = await supabase
      .from("catalog")
      .select(CATALOG_COLUMNS)
      .order("updated_at", { ascending: false })
      .limit(200);
    if (selErr) {
      setError(selErr.message ?? "Failed to load catalog.");
    } else {
      setItems((data ?? []) as unknown as CatalogItem[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchByUpc = async (item: CatalogItem): Promise<ActionResult> => {
    if (!item.upc) return { ok: false, msg: "No UPC on this item." };
    setFetchingId(item.id);
    let result: ActionResult;
    try {
      const nutRes = await fetch("/api/nutrition", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ mode: "gtin", gtin: item.upc }),
      });
      const nutData = await nutRes.json();
      if (!nutRes.ok || !nutData.hit) {
        result = { ok: false, msg: nutData.miss_reason ?? nutData.error ?? "Not found in FDC or Open Food Facts" };
      } else {
        const saveRes = await fetch("/api/catalog-nutrition", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ mode: "auto", catalogId: item.id, result: nutData }),
        });
        const saveData = await saveRes.json();
        if (!saveRes.ok) throw new Error(saveData.error || `Error ${saveRes.status}`);
        const srcLabel = nutData.source === "usda" ? "USDA FDC" : "Open Food Facts";
        result = { ok: true, msg: `Saved from ${srcLabel} — ${Math.round(nutData.kcal_per_100g)} Calories/100g` };
        await load();
      }
    } catch (e: any) {
      result = { ok: false, msg: e?.message ?? "Failed" };
    }
    setStatusMsg((p) => ({ ...p, [item.id]: result }));
    setFetchingId(null);
    return result;
  };

  const saveManual = async (item: CatalogItem, vals: ManualVals): Promise<ActionResult> => {
    setSavingId(item.id);
    const kcal = vals.kcal ? Number(vals.kcal) : null;
    const servG = vals.serving_g ? Number(vals.serving_g) : null;
    const protein = vals.protein ? Number(vals.protein) : null;
    const fat = vals.fat ? Number(vals.fat) : null;
    const carbs = vals.carbs ? Number(vals.carbs) : null;
    const macros = protein != null && fat != null && carbs != null
      ? { protein_g: protein, fat_g: fat, carbs_g: carbs }
      : null;
    let result: ActionResult;
    try {
      const res = await fetch("/api/catalog-nutrition", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ mode: "manual", catalogId: item.id, kcal_per_100g: kcal, serving_g: servG, macros }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      result = { ok: true, msg: "Saved manually" };
      await load();
    } catch (e: any) {
      result = { ok: false, msg: e?.message ?? "Failed" };
    }
    setStatusMsg((p) => ({ ...p, [item.id]: result }));
    setSavingId(null);
    return result;
  };

  const rows = items ?? [];
  const selectedItem = rows.find((it) => it.id === selectedItemId) ?? null;

  const columns = useMemo<ColumnDef<CatalogItem>[]>(
    () => [
      {
        id: "product",
        header: "Product",
        accessorFn: (it) => it.product_name ?? it.normalized_product,
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-foreground">{row.original.product_name ?? row.original.normalized_product}</div>
            {row.original.package_size && (
              <div className="text-xs text-muted-foreground">{row.original.package_size}</div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "category",
        header: "Category",
        cell: (info) => (info.getValue() as string | null) ?? "—",
      },
      {
        accessorKey: "upc",
        header: "UPC",
        enableSorting: false,
        cell: (info) => {
          const upc = info.getValue() as string | null;
          return upc ? <span className="font-mono text-xs text-muted-foreground">{upc}</span> : "—";
        },
      },
      {
        id: "nutrition",
        header: "Nutrition",
        accessorFn: (it) => it.kcal_per_100g ?? -1,
        cell: ({ row }) => {
          const it = row.original;
          if (it.kcal_per_100g == null) return <span className="text-muted-foreground">Not set</span>;
          const srcLabel = it.nutrition_source === "usda" ? "USDA" : it.nutrition_source === "off" ? "OFF" : it.nutrition_source === "manual" ? "Manual" : null;
          return (
            <span className="inline-flex items-center gap-1.5">
              <span className="tabular-nums">{Math.round(it.kcal_per_100g)} Cal/100g</span>
              {srcLabel && <Badge variant="secondary">{srcLabel}</Badge>}
            </span>
          );
        },
      },
      {
        accessorKey: "updated_at",
        header: "Updated",
        cell: (info) => formatDate(info.getValue() as string),
      },
    ],
    []
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    globalFilterFn: (row, _columnId, filterValue) => {
      const q = String(filterValue).toLowerCase().trim();
      if (!q) return true;
      const it = row.original;
      const name = (it.product_name ?? it.normalized_product).toLowerCase();
      return name.includes(q) || (it.category ?? "").toLowerCase().includes(q) || (it.upc ?? "").includes(q);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading catalog…</p>;
  }

  if (error) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-destructive">
        <AlertCircle size={14} /> {error}
      </p>
    );
  }

  const visibleRows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">
          Catalog ({visibleRows.length}
          {visibleRows.length !== rows.length ? ` of ${rows.length}` : ""})
        </h2>
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </Button>
      </div>

      <div className="relative w-full max-w-xs">
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products…"
          className="pl-8"
        />
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
          {visibleRows.map((row) => (
            <TableRow key={row.id} className="cursor-pointer" onClick={() => setSelectedItemId(row.original.id)}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {visibleRows.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? "No catalog items yet — log a receipt to populate." : "No items match this search."}
        </p>
      )}

      {selectedItem && (
        <CatalogDrillDownPanel
          item={selectedItem}
          fetching={fetchingId === selectedItem.id}
          saving={savingId === selectedItem.id}
          status={statusMsg[selectedItem.id] ?? null}
          onClose={() => setSelectedItemId(null)}
          onFetchByUpc={fetchByUpc}
          onSaveManual={saveManual}
        />
      )}
    </div>
  );
}
