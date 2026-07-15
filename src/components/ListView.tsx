import { useState, useEffect } from "react";
import {
  Plus, X, Check, Copy, RefreshCw,
  CheckCircle2, Star, ShoppingCart, Undo2, PackageCheck,
} from "lucide-react";
import { supabase } from "@terenc/shared/supabase";
import { normalizeIngName } from "../lib/normalize";
import { buildInstacartHandoff } from "../lib/instacart-handoff";
import { CATEGORIES } from "../lib/recipeGenerate.js";
import { additionCategory } from "../lib/shoppingExclusion";
import { s } from "../lib/styles";
import { uid, useIsMobile } from "../lib/utils";
import { fmtPurchaseQty } from "../lib/format";
import ShareListControls from "./ShareListControls";

export default function ListView({ groceryList, totalItems, listText, checkedItems, setCheckedItems, weekAdditions, setWeekAdditions, weekHaveIt, setWeekHaveIt, slotCount, location, onMarkOrdered, scopeCount, canUnmark, onUnmarkOrder, alwaysHave, setAlwaysHave, session, qualificationNumber, setQualificationNumber }: any) {
  const isMobile = useIsMobile();
  const [copied, setCopied] = useState(false);
  const [copiedCart, setCopiedCart] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [newAlwaysHave, setNewAlwaysHave] = useState("");
  const [addName, setAddName] = useState("");
  const [addQty, setAddQty] = useState("");
  const [addCategory, setAddCategory] = useState("Other");
  // Catalog is kept (TER-389 drops price display, not the catalog) — its UPC hints
  // feed buildInstacartHandoff below.
  const [catalog, setCatalog] = useState<Array<{ normalized_name: string | null; upc: string | null; last_price_cents: number | null }>>([]);

  useEffect(() => {
    if (!session) return;
    const names = (Object.values(groceryList) as Array<Array<{ name: string }>>)
      .flat()
      .map((it) => normalizeIngName(it.name))
      .filter(Boolean);
    if (names.length === 0) { setCatalog([]); return; }
    supabase.from("catalog").select("normalized_name, upc, last_price_cents").in("normalized_name", names).then(({ data }) => {
      if (data) setCatalog(data as Array<{ normalized_name: string | null; upc: string | null; last_price_cents: number | null }>);
    });
  }, [session, groceryList]);

  const handleAddItem = () => {
    const name = addName.trim();
    if (!name) return;
    setWeekAdditions((prev: any[]) => [...prev, { id: uid(), name, qty: addQty.trim(), category: addCategory }]);
    setAddName(""); setAddQty(""); setAddCategory("Other");
  };

  const copy = async () => {
    const addText = weekAdditions.length
      ? "\n\nAdded by you:\n" + weekAdditions.map((it: any) => `  - ${it.name}${it.qty ? ` (${it.qty})` : ""}`).join("\n")
      : "";
    try { await navigator.clipboard.writeText(listText + addText); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
  };
  const copyForInstacartAI = async () => {
    const { preamble, lines } = buildInstacartHandoff(groceryList, catalog);
    const addLines = weekAdditions.map((it: any) => `- ${it.name}${it.qty ? ` — ${it.qty}` : ""}`);
    const text = `${preamble}\n\n${[...lines, ...addLines].join("\n")}`;
    try { await navigator.clipboard.writeText(text); setCopiedCart(true); setTimeout(() => setCopiedCart(false), 1800); } catch {}
  };
  const markOrdered = async () => {
    const head = scopeCount === 1 ? "Mark this dinner as purchased?" : `Mark these ${scopeCount} dinners as purchased?`;
    if (!window.confirm(`${head}\n\nYour meals stay on their dates — the shopping list will clear.`)) return;
    setOrdering(true);
    setOrderError(null);
    const { error } = await onMarkOrdered();
    setOrdering(false);
    if (error) setOrderError(error);
  };
  const toggleCheck = (k: string) => setCheckedItems((p: any) => ({ ...p, [k]: !p[k] }));
  // TER-504: per-row "have it" toggles the PER-WEEK override, never the durable
  // `alwaysHave` exclusion list.
  const toggleWeekHaveIt = (name: string) => {
    const k = normalizeIngName(name);
    setWeekHaveIt((p: string[]) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]);
  };
  const addAlwaysHave = () => {
    const k = normalizeIngName(newAlwaysHave);
    if (!k) return;
    setAlwaysHave((p: string[]) => p.includes(k) ? p : [...p, k]);
    setNewAlwaysHave("");
  };

  // TER-504: user-added items fold into their own category card. Legacy additions
  // (no category field) default to "Other".
  const additionsByCat: Record<string, any[]> = {};
  CATEGORIES.forEach((c) => (additionsByCat[c] = []));
  weekAdditions.forEach((it: any) => additionsByCat[additionCategory(it.category)].push(it));

  const listIsEmpty = totalItems === 0 && weekAdditions.length === 0;

  return (
    <div>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "var(--space-4)" }}>
          <h1 style={{ ...s.typeH1, margin: 0 }}>Shopping list</h1>
          <p style={{ ...s.typeBodySm, color: "var(--c-text-muted)", margin: "2px 0 0" }}>
            {totalItems} items · {scopeCount}/{slotCount} dinners to shop + staples
          </p>
        </div>

        {/* Toolbar */}
        <div style={{ display: "flex", flexWrap: "wrap" as const, gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
          <button onClick={copy} className="btn-primary" style={{ flex: isMobile ? "1 1 auto" : "0 0 auto" }}>
            {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
            {copied ? "Copied!" : "Copy list"}
          </button>
          <button onClick={copyForInstacartAI} className="btn-secondary" style={{ flex: isMobile ? "1 1 auto" : "0 0 auto" }}>
            {copiedCart ? <CheckCircle2 size={16} /> : <ShoppingCart size={16} />}
            {copiedCart ? "Copied!" : "Instacart (AI)"}
          </button>
        </div>

        {/* Share list (TER-287) */}
        <ShareListControls session={session} groceryList={groceryList} totalItems={totalItems} />

        {/* Always Have sunken panel (durable staples — typed-add only) */}
        <div style={s.lvSunken}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-2)" }}>
            <span style={{ ...s.typeH3, fontSize: 15, color: "var(--c-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Star size={15} color="var(--c-warning)" fill="var(--c-warning)" />
              Always have
            </span>
            <span style={{ ...s.typeCaption, color: "var(--c-text-muted)" }}>auto-excluded weekly</span>
          </div>
          {alwaysHave.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: "var(--space-2)", marginBottom: "var(--space-2)" }}>
              {alwaysHave.map((k: string) => (
                <span key={k} style={s.lvAhChip}>
                  {k}
                  <button onClick={() => setAlwaysHave((p: string[]) => p.filter((x) => x !== k))} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "grid", color: "rgba(255,255,255,0.65)", lineHeight: 1 }}><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={newAlwaysHave}
              onChange={(e) => setNewAlwaysHave(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addAlwaysHave()}
              placeholder="Add item (e.g. olive oil)…"
              style={{ ...s.input, flex: 1, fontSize: 12.5, padding: "6px 9px" }}
            />
            <button onClick={addAlwaysHave} disabled={!newAlwaysHave.trim()} style={{ ...s.addBtn, opacity: newAlwaysHave.trim() ? 1 : 0.45 }}><Plus size={14} /> Add</button>
          </div>
        </div>

        {/* Unified category cards — grocery items + your additions, one list */}
        {listIsEmpty ? (
          <div style={s.card}><p style={s.empty}>Accept dinners to build the list (staples always included).</p></div>
        ) : (
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            {CATEGORIES.map((cat) => {
              const items = groceryList[cat] ?? [];
              const adds = additionsByCat[cat] ?? [];
              if (!items.length && !adds.length) return null;
              return (
                <div key={cat} style={s.lvCatCard}>
                  <h3 style={s.lvCatTitle}>{cat}</h3>
                  <div>
                    {items.map((it: any) => {
                      const key = `${it.name}|${it.unit}`;
                      const checked = !!checkedItems[key];
                      const isHave = weekHaveIt.includes(normalizeIngName(it.name)); // TER-504: per-week override
                      return (
                        <div key={key} style={s.lvRow}>
                          <button
                            onClick={() => toggleCheck(key)}
                            aria-label={checked ? "Uncheck item" : "Check item"}
                            style={{ ...s.lvCheck, background: checked ? "var(--c-primary)" : "var(--c-surface)", borderColor: checked ? "var(--c-primary)" : "var(--c-border)" }}
                          >
                            {checked && <Check size={14} color="var(--c-on-primary)" strokeWidth={2.6} />}
                          </button>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ ...s.typeBody, color: checked ? "var(--c-text-muted)" : "var(--c-text)", textDecoration: checked ? "line-through" : "none" }}>
                              {it.name}
                            </span>
                            <span style={{ ...s.typeBodySm, color: "var(--c-text-muted)" }}>
                              {" · "}{fmtPurchaseQty(it.qty, it.unit, it.isPurchaseStyle)}
                            </span>
                            {it.staple && <span style={s.lvStaple}>staple</span>}
                          </span>
                          <button
                            onClick={() => toggleWeekHaveIt(it.name)}
                            aria-pressed={isHave}
                            style={{ ...s.lvHaveIt, color: isHave ? "var(--c-on-primary)" : "var(--c-text-muted)", background: isHave ? "var(--c-primary)" : "transparent", borderColor: isHave ? "var(--c-primary)" : "var(--c-border)" }}
                          >have it</button>
                        </div>
                      );
                    })}
                    {adds.map((it: any) => {
                      const key = `manual|${it.id}`;
                      const checked = !!checkedItems[key];
                      return (
                        <div key={it.id} style={s.lvRow}>
                          <button
                            onClick={() => setCheckedItems((p: any) => ({ ...p, [key]: !p[key] }))}
                            aria-label={checked ? "Uncheck" : "Check"}
                            style={{ ...s.lvCheck, background: checked ? "var(--c-primary)" : "var(--c-surface)", borderColor: checked ? "var(--c-primary)" : "var(--c-border)" }}
                          >
                            {checked && <Check size={14} color="var(--c-on-primary)" strokeWidth={2.6} />}
                          </button>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ ...s.typeBody, color: checked ? "var(--c-text-muted)" : "var(--c-text)", textDecoration: checked ? "line-through" : "none" }}>
                              {it.name}
                            </span>
                            {it.qty && (
                              <span style={{ ...s.typeBodySm, color: "var(--c-text-muted)" }}>{" · "}{it.qty}</span>
                            )}
                            <span style={s.lvAddedTag}>added</span>
                          </span>
                          <button
                            onClick={() => setWeekAdditions((prev: any[]) => prev.filter((x: any) => x.id !== it.id))}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--c-text-muted)", display: "grid", lineHeight: 1 }}
                            aria-label="Remove item"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add an item (Need-it: week additions are never filtered by have-it/always-have) */}
        <div style={{ marginTop: "var(--space-4)" }}>
          <div style={s.lvCatCard}>
            <h3 style={s.lvCatTitle}>Add an item</h3>
            <p style={{ ...s.lvMicrocopy, margin: "0 0 var(--space-3)" }}>
              Need something you usually have on hand? Add it here for this week.
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
              <input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
                placeholder="Item name…"
                style={{ ...s.input, flex: "2 1 120px", fontSize: 12.5, padding: "6px 9px" }}
              />
              <input
                value={addQty}
                onChange={(e) => setAddQty(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddItem()}
                placeholder="Qty (optional)"
                style={{ ...s.input, flex: "1 1 80px", fontSize: 12.5, padding: "6px 9px" }}
              />
              <select
                value={addCategory}
                onChange={(e) => setAddCategory(e.target.value)}
                aria-label="Category"
                style={{ ...s.lvAddSelect, flex: "1 1 110px" }}
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button onClick={handleAddItem} disabled={!addName.trim()} style={{ ...s.addBtn, opacity: addName.trim() ? 1 : 0.45 }}>
                <Plus size={14} /> Add
              </button>
            </div>
          </div>
        </div>

        {/* Mark Purchased (TER-422: stamps scope meals; nothing is deleted) */}
        {orderError && <p style={{ color: "var(--c-danger)", fontSize: 12, margin: "8px 0 4px" }}>Couldn't save the order: {orderError}</p>}
        <button
          onClick={markOrdered}
          disabled={scopeCount === 0 || ordering}
          className="btn-ghost btn--sm btn--block"
          style={{ marginTop: "var(--space-4)" }}
        >
          {ordering ? <RefreshCw size={14} className="spin" /> : <PackageCheck size={14} />}
          {ordering ? "Marking..." : "Mark Purchased"}
        </button>
        <p style={{ ...s.lvMicrocopy, textAlign: "center" as const, margin: "var(--space-2) 0 0" }}>
          Closes this trip — purchased dinners leave the list and your week's overrides reset.
        </p>
        {canUnmark && (
          <button onClick={onUnmarkOrder} className="btn-ghost btn--sm btn--block" style={{ marginTop: "var(--space-2)" }}>
            <Undo2 size={14} /> Undo last purchase
          </button>
        )}
      </div>
    </div>
  );
}
