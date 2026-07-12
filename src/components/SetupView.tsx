import { useState, useEffect } from "react";
import {
  CalendarDays, MapPin, Plus, X, Check, Star, RefreshCw, Sparkles,
} from "lucide-react";
import { normalizeIngName } from "../lib/normalize";
import { parseAvoidInput } from "../lib/avoidGuard";
import { uid } from "../lib/utils";
import { s } from "../lib/styles";
import { wx, weekdayLabel, EFFORT_LEVELS } from "../App";
import ChipManager from "./ChipManager";

const CUISINES = ["Any", "American", "Comfort food", "Italian", "Mexican", "Tex-Mex", "Asian", "Chinese", "Thai", "Indian", "Mediterranean", "Greek", "BBQ", "Soup / Stew", "Salad-forward"];
const TEMPS = ["Auto", "Either", "Hot", "Cold"];

/* ============================ PeopleInput ============================ */
function PeopleInput({ value, onChange, style }: { value: number; onChange: (n: number) => void; style?: React.CSSProperties }) {
  const [draft, setDraft] = useState<string>(String(value));

  // Keep draft in sync when parent changes value externally (e.g. "set everyone to N")
  useEffect(() => { setDraft(String(value)); }, [value]);

  return (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      value={draft}
      style={{ textAlign: "center", ...style }}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = Math.max(1, parseInt(draft, 10) || 1);
        setDraft(String(n));
        onChange(n);
      }}
    />
  );
}

/* ============================ Setup ============================ */
export default function SetupView(p: any) {
  const { location, geocode, startDate, setStartDate, numDays, setNumDays, days, updDay, dateFor, forecast, fxStatus,
    defaultPeople, setDefaultPeople, efficiency, setEfficiency, mixCuisines, setMixCuisines, staples, setStaples,
    rotation, avoidTerms, setAvoidTerms, alwaysHave, setAlwaysHave, weekNote, setWeekNote, onGenerate, busy, isMobile } = p;
  const [showStaples, setShowStaples] = useState(false);
  const [showNotesHelp, setShowNotesHelp] = useState(false);
  const [applyConfirm, setApplyConfirm] = useState<string | null>(null);
  const [locInput, setLocInput] = useState("");
  const [avoidInput, setAvoidInput] = useState("");
  const [newPantry, setNewPantry] = useState("");

  // TER-532: one-time append copy-down — every day's note gets the week note
  // folded in, separated by a blank line if the day already has text. After
  // this, day notes are fully independent again (no linkage back to the week note).
  useEffect(() => {
    if (!applyConfirm) return;
    const t = setTimeout(() => setApplyConfirm(null), 3000);
    return () => clearTimeout(t);
  }, [applyConfirm]);

  const applyWeekNoteToAllDays = () => {
    const note = weekNote.trim();
    if (!note) return;
    days.forEach((day: any) => updDay(day.id, { note: day.note ? `${day.note}\n\n${note}` : note }));
    setApplyConfirm(`Added to ${days.length} day${days.length === 1 ? "" : "s"}`);
  };

  // TER-330: the unified pantry list (durable exclude-from-buy set) now lives in
  // Setup. Backed by the normalized `alwaysHave` key, same as the Shopping List.
  const addPantry = () => {
    const k = normalizeIngName(newPantry);
    if (!k) return;
    setAlwaysHave((prev: string[]) => prev.includes(k) ? prev : [...prev, k]);
    setNewPantry("");
  };
  const removePantry = (k: string) => setAlwaysHave((prev: string[]) => prev.filter((x) => x !== k));

  // TER-401: comma/Enter-parsed terms, lowercased and deduped.
  const addAvoidTerms = (raw: string) => {
    const terms = parseAvoidInput(raw);
    if (terms.length) setAvoidTerms((prev: string[]) => [...prev, ...terms.filter((t) => !prev.includes(t))]);
    setAvoidInput("");
  };

  // TER-401 addendum: typed-but-unconfirmed avoid text must still protect the
  // generation it precedes. Commit it to the chip list and hand the parsed
  // terms to generateAll, which merges them into the run's list directly
  // (the state update can't be read back in the same event — React batching).
  const handleGenerate = () => {
    const pending = parseAvoidInput(avoidInput);
    if (pending.length) addAvoidTerms(avoidInput);
    onGenerate(pending);
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={s.card}>
        <h3 style={s.cardTitle}>Week note</h3>
        <p style={s.cardSub}>One note for the whole week — use "Apply to all days" to fold it into every day's note below.</p>
        <textarea
          value={weekNote}
          onChange={(e) => setWeekNote(e.target.value)}
          placeholder="Min 40g protein per serving · no fish · kid-friendly"
          rows={2}
          style={{ ...s.input, width: "100%", marginTop: 10, resize: "vertical", fontFamily: "inherit" }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" as const }}>
          <button onClick={applyWeekNoteToAllDays} disabled={!weekNote.trim()} className="btn-secondary btn--sm">
            Apply to all days
          </button>
          {applyConfirm && <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--c-primary)" }}>{applyConfirm}</span>}
        </div>
        <button onClick={() => setShowNotesHelp((v) => !v)} style={{ ...s.collapseBtn, marginTop: 10 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--c-text-muted)" }}>What can notes do?</span>
          <span style={s.miniLabel}>{showNotesHelp ? "hide" : "show"}</span>
        </button>
        {showNotesHelp && (
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            <p style={s.cardSub}><strong>Nutrition targets</strong> (estimates the planner aims for) — "Min 40g protein, 20g fiber per serving"</p>
            <p style={s.cardSub}><strong>Exclusions</strong> (preferences we steer around, not a guarantee against allergens — always check ingredient labels yourself) — "no fish," "no pork"</p>
            <p style={s.cardSub}><strong>Use-it-up</strong> — "Use the chicken in the fridge"</p>
            <p style={s.cardSub}><strong>Audience</strong> — "Kid-friendly"</p>
            <p style={s.cardSub}><strong>Method/equipment</strong> — "Slow cooker," "one pan," "grill"</p>
            <p style={s.cardSub}><strong>Leftovers/format</strong> — "Enough for lunch next day," "handheld"</p>
            <p style={s.cardSub}><strong>Budget</strong> — "Keep it cheap this week"</p>
          </div>
        )}
      </div>

      <div style={s.card}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 150 }}>
            <label style={s.fieldLabel}><CalendarDays size={12} style={{ verticalAlign: -2 }} /> Planning week</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ ...s.input, width: "100%" }} />
          </div>
          <div style={{ width: 96 }}>
            <label style={s.fieldLabel}>Days to plan</label>
            <select value={numDays} onChange={(e) => setNumDays(Number(e.target.value))} style={{ ...s.input, width: "100%" }}>
              {[3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div style={{ width: 64 }}>
            <label style={s.fieldLabel}>People</label>
            <PeopleInput value={defaultPeople} onChange={setDefaultPeople} style={{ ...s.input, width: "100%" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
          <MapPin size={14} color="var(--c-text-muted)" />
          <span style={{ fontSize: 13, color: "var(--c-text-muted)" }}>{location?.name ?? "Set your location"}</span>
          <input value={locInput} onChange={(e) => setLocInput(e.target.value)} placeholder="change location" style={{ ...s.input, flex: 1, fontSize: 12.5, padding: "6px 9px" }}
            onKeyDown={(e) => { if (e.key === "Enter" && locInput.trim()) { geocode(locInput.trim()); setLocInput(""); } }} />
          <span style={s.miniLabel}>{fxStatus === "loading" ? "loading wx..." : fxStatus === "error" ? "wx unavailable" : ""}</span>
        </div>
      </div>

      <div style={s.card}>
        <h3 style={s.cardTitle}>Allergies &amp; avoid list</h3>
        <p style={s.cardSub}>Ingredients to avoid on every day of every week until removed (e.g. pork, peanuts). Every recipe is generated and checked against this list including common derived forms (bacon, peanut oil, …). Verify every ingredient and package label yourself — not an allergen-safety guarantee.</p>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input
            value={avoidInput}
            onChange={(e) => setAvoidInput(e.target.value)}
            placeholder="add terms, comma-separated (e.g. pork, peanuts)"
            style={{ ...s.input, flex: 1, fontSize: 12.5 }}
            onKeyDown={(e) => { if (e.key === "Enter" && avoidInput.trim()) addAvoidTerms(avoidInput); }}
            onBlur={() => { if (avoidInput.trim()) addAvoidTerms(avoidInput); }}
          />
          <button onClick={() => { if (avoidInput.trim()) addAvoidTerms(avoidInput); }} className="btn-ghost btn--sm">
            <Plus size={14} /> Add
          </button>
        </div>
        <ChipManager
          items={avoidTerms}
          onRemove={(x: string) => setAvoidTerms((prev: string[]) => prev.filter((t: string) => t !== x))}
          empty="No restrictions set."
          tone="red"
        />
      </div>

      <div style={s.card}>
        <h3 style={s.cardTitle}>Your week</h3>
        <p style={s.cardSub}>Forecast auto-fills. Temp = Auto adapts the dish to the weather.</p>
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {days.map((day: any, i: number) => {
            const date = dateFor(i); const fx = forecast[date]; const w = fx ? wx(fx.code) : null;
            return (
              <div key={day.id} style={{ ...s.dayBlock, opacity: day.skip ? 0.7 : 1 }}>
                <div style={s.sdrHead}>
                  <span style={s.dayDate}>{weekdayLabel(date)}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" as const }}>
                    {fx ? <span style={s.fxChip}>{w!.e} {fx.hi}/{fx.lo}F - {w!.l}</span> : <span style={s.fxChipMuted}>no forecast</span>}
                    <button
                      onClick={() => updDay(day.id, { skip: !day.skip })}
                      style={s.sdrSkipBtn}
                      aria-pressed={!!day.skip}
                      title={day.skip ? "Add dinner back for this day" : "Skip this day — no dinner"}
                    >
                      <span style={{ ...s.sdrCheck, background: day.skip ? "var(--c-primary)" : "var(--c-surface)", borderColor: day.skip ? "var(--c-primary)" : "var(--c-border)" }}>
                        {day.skip && <Check size={12} color="var(--c-on-primary)" strokeWidth={2.6} />}
                      </span>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: day.skip ? "var(--c-primary)" : "var(--c-text-muted)" }}>Skip day</span>
                    </button>
                  </div>
                </div>
                {day.skip ? (
                  <p style={s.sdrSkipMsg}>No dinner this day — we'll leave {weekdayLabel(date)} off the plan and the shopping list.</p>
                ) : (
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ ...s.slotRow, flexWrap: isMobile ? "wrap" as const : undefined }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <PeopleInput value={day.people} onChange={(n) => updDay(day.id, { people: n })} style={{ ...s.input, width: 50 }} />
                        <span style={s.miniLabel}>ppl</span>
                      </div>
                      <select value={day.cuisine} onChange={(e) => updDay(day.id, { cuisine: e.target.value })} style={{ ...s.input, flex: 1, minWidth: isMobile ? 0 : 100 }}>{CUISINES.map((c) => <option key={c}>{c}</option>)}</select>
                      <select value={day.temp} onChange={(e) => updDay(day.id, { temp: e.target.value })} style={{ ...s.input, width: isMobile ? "100%" : 82 }}>{TEMPS.map((t) => <option key={t}>{t}</option>)}</select>
                      <select
                        aria-label="Desired effort"
                        value={day.effort ?? "any"}
                        onChange={(e) => updDay(day.id, { effort: e.target.value })}
                        disabled={!!day.pinnedRecipe}
                        title={day.pinnedRecipe ? "Pinned days skip generation" : "Desired cooking effort"}
                        style={{ ...s.input, width: isMobile ? "100%" : 130 }}
                      >
                        {EFFORT_LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <select
                        value={day.pinnedRecipe?.name ?? ""}
                        onChange={(e) => {
                          const found = rotation.find((r: any) => r.name === e.target.value);
                          updDay(day.id, { pinnedRecipe: found ? { ...found } : undefined });
                        }}
                        style={{ ...s.input, flex: 1 }}
                        disabled={rotation.length === 0}
                        title={rotation.length === 0 ? "Save a recipe to your Recipe Box first" : ""}
                      >
                        <option value="">{rotation.length === 0 ? "Save a recipe to Recipe Box first" : "None (generate)"}</option>
                        {rotation.map((r: any) => <option key={r.name} value={r.name}>{r.name}</option>)}
                      </select>
                      {day.pinnedRecipe && <span style={{ fontSize: 12, color: "var(--c-primary)", fontWeight: 700, whiteSpace: "nowrap" as const }}>📌 Pinned</span>}
                    </div>
                    <input value={day.note} onChange={(e) => updDay(day.id, { note: e.target.value })} placeholder="optional note" style={{ ...s.input, fontSize: 12.5, width: "100%" }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <label style={s.toggleRow}>
        <input type="checkbox" checked={mixCuisines} onChange={(e) => setMixCuisines(e.target.checked)} style={{ width: 17, height: 17, marginTop: 2 }} />
        <span><strong>Mix up cuisines</strong><span style={s.cardSub}> - force variety across the week.</span></span>
      </label>
      <label style={s.toggleRow}>
        <input type="checkbox" checked={efficiency} onChange={(e) => setEfficiency(e.target.checked)} style={{ width: 17, height: 17, marginTop: 2 }} />
        <span><strong>Efficient ingredient reuse</strong><span style={s.cardSub}> - share ingredients across meals (whole chicken, bulk-poach &amp; shred). Avoids double-buying.</span></span>
      </label>

      {/* TER-330: unified pantry list — durable exclude-from-buy set, backed by alwaysHave */}
      <div style={s.card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-2)", gap: 8, flexWrap: "wrap" as const }}>
          <span style={{ ...s.typeH3, fontSize: 15, color: "var(--c-primary)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Star size={15} color="var(--c-warning)" fill="var(--c-warning)" />
            Pantry — always have
          </span>
          <span style={{ ...s.typeCaption, color: "var(--c-text-muted)" }}>auto-excluded from every buy list</span>
        </div>
        <p style={s.cardSub}>Items you keep on hand — we leave these off the shopping list every week. (Staples below are the opposite: always <em>added</em> to the list.)</p>
        {alwaysHave.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap" as const, gap: "var(--space-2)", margin: "10px 0" }}>
            {alwaysHave.map((k: string) => (
              <span key={k} style={s.lvAhChip}>
                {k}
                <button onClick={() => removePantry(k)} aria-label={`Remove ${k}`} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "grid", color: "rgba(255,255,255,0.65)", lineHeight: 1 }}><X size={12} /></button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <input
            value={newPantry}
            onChange={(e) => setNewPantry(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addPantry(); }}
            placeholder="Add item (e.g. olive oil)…"
            style={{ ...s.input, flex: 1, fontSize: 12.5 }}
          />
          <button onClick={addPantry} disabled={!newPantry.trim()} style={{ ...s.addBtn, opacity: newPantry.trim() ? 1 : 0.45 }}><Plus size={14} /> Add</button>
        </div>
      </div>

      <div style={s.card}>
        <button onClick={() => setShowStaples((v) => !v)} style={s.collapseBtn}>
          <span><strong>Weekly staples</strong> <span style={s.cardSub}>- always added</span></span>
          <span style={s.miniLabel}>{staples.filter((x: any) => x.enabled).length} on - {showStaples ? "hide" : "edit"}</span>
        </button>
        {showStaples && (
          <div style={{ display: "grid", gap: 7, marginTop: 12 }}>
            {staples.map((st: any) => (
              <div key={st.id} style={s.slotRow}>
                <input type="checkbox" checked={st.enabled} onChange={(e) => setStaples((q: any[]) => q.map((x) => x.id === st.id ? { ...x, enabled: e.target.checked } : x))} style={{ width: 16, height: 16 }} />
                <input value={st.name} onChange={(e) => setStaples((q: any[]) => q.map((x) => x.id === st.id ? { ...x, name: e.target.value } : x))} style={{ ...s.input, flex: 2 }} />
                <input type="number" value={st.qty} onChange={(e) => setStaples((q: any[]) => q.map((x) => x.id === st.id ? { ...x, qty: Number(e.target.value) } : x))} style={{ ...s.input, width: 48 }} />
                <input value={st.unit} onChange={(e) => setStaples((q: any[]) => q.map((x) => x.id === st.id ? { ...x, unit: e.target.value } : x))} style={{ ...s.input, width: 66 }} />
                <button onClick={() => setStaples((q: any[]) => q.filter((x) => x.id !== st.id))} style={s.iconBtn}><X size={14} color="var(--c-danger)" /></button>
              </div>
            ))}
            <button onClick={() => setStaples((q: any[]) => [...q, { id: uid(), name: "", qty: 1, unit: "", category: "Pantry", enabled: true }])} style={{ ...s.addBtn, marginTop: 4 }}><Plus size={15} /> Add staple</button>
          </div>
        )}
      </div>

      <button onClick={handleGenerate} disabled={busy} className="btn-primary btn--block" style={{ opacity: busy ? 0.6 : 1 }}>
        {busy ? <><RefreshCw size={17} className="spin" /> Generating...</> : <><Sparkles size={17} /> Generate meal plan</>}
      </button>
    </div>
  );
}
