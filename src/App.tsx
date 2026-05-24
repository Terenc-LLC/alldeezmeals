import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Plus, Trash2, X, Check, Copy, Sparkles, RefreshCw, Settings2,
  Utensils, ListChecks, CheckCircle2, AlertCircle, Repeat,
  ThumbsUp, ThumbsDown, Star, MapPin, CalendarDays,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  ALLDEEZMeals - ALDI family meal planner, weather-aware, learns      */
/*  Weather: Open-Meteo (free, keyless, direct).                        */
/*  Meal gen: POST /api/generate (serverless proxy holds the key).      */
/*  Storage: localStorage.                                              */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "alldeezmeals-v1";
const uid = () => Math.random().toString(36).slice(2, 10);

const CATEGORIES = ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry", "Frozen", "Bakery", "Other"];
const CUISINES = ["Any", "American", "Comfort food", "Italian", "Mexican", "Tex-Mex", "Asian", "Chinese", "Thai", "Indian", "Mediterranean", "Greek", "BBQ", "Soup / Stew", "Salad-forward"];
const TEMPS = ["Auto", "Either", "Hot", "Cold"];

const DEFAULT_LOCATION = { name: "Bloomfield, IA", lat: 40.7517, lon: -92.4154 };

const DEFAULT_STAPLES = [
  { id: uid(), name: "whole milk plain Greek yogurt", qty: 2, unit: "container", category: "Dairy & Eggs", enabled: true },
  { id: uid(), name: "frozen mixed berries / fruit", qty: 1, unit: "bag", category: "Frozen", enabled: true },
  { id: uid(), name: "Honey Nut Cheerios (generic)", qty: 1, unit: "box", category: "Pantry", enabled: true },
  { id: uid(), name: "plain oat milk", qty: 1, unit: "1/2 gal", category: "Dairy & Eggs", enabled: true },
  { id: uid(), name: "ground Sumatra coffee", qty: 1, unit: "bag", category: "Pantry", enabled: true },
  { id: uid(), name: "salted butter", qty: 1, unit: "lb", category: "Dairy & Eggs", enabled: true },
  { id: uid(), name: "2% milk", qty: 1, unit: "1/2 gal", category: "Dairy & Eggs", enabled: true },
  { id: uid(), name: "sliced deli honey ham", qty: 1, unit: "lb", category: "Meat & Seafood", enabled: true },
  { id: uid(), name: "sliced Jack cheese", qty: 1, unit: "pack", category: "Dairy & Eggs", enabled: true },
  { id: uid(), name: "whole wheat bread", qty: 2, unit: "loaf", category: "Bakery", enabled: true },
  { id: uid(), name: "multi-grain bread", qty: 1, unit: "loaf", category: "Bakery", enabled: true },
  { id: uid(), name: "burrito-size tortillas", qty: 1, unit: "pack", category: "Bakery", enabled: true },
];

/* ---- date helpers ---- */
const isoToday = () => toISO(new Date());
function toISO(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function parseISO(s: string) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(iso: string, n: number) { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
function weekdayLabel(iso: string) { return parseISO(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }

/* ---- WMO weather code -> label/emoji ---- */
function wx(code: number) {
  if (code === 0) return { e: "\u2600\uFE0F", l: "Clear" };
  if (code <= 3) return { e: "\u26C5", l: "Partly cloudy" };
  if (code <= 48) return { e: "\uD83C\uDF2B\uFE0F", l: "Fog" };
  if (code <= 57) return { e: "\uD83C\uDF26\uFE0F", l: "Drizzle" };
  if (code <= 67) return { e: "\uD83C\uDF27\uFE0F", l: "Rain" };
  if (code <= 77) return { e: "\u2744\uFE0F", l: "Snow" };
  if (code <= 82) return { e: "\uD83C\uDF26\uFE0F", l: "Showers" };
  if (code <= 86) return { e: "\uD83C\uDF28\uFE0F", l: "Snow showers" };
  return { e: "\u26C8\uFE0F", l: "Thunderstorm" };
}
const tempBand = (hi: number | null | undefined) => (hi == null ? "mild" : hi >= 82 ? "hot" : hi <= 45 ? "cold" : "mild");

const makeDay = (people = 4) => ({ id: uid(), people, cuisine: "Any", temp: "Auto", note: "" });

/* ====================================================================== */
export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("setup");

  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [startDate, setStartDate] = useState(isoToday());
  const [numDays, setNumDays] = useState(7);
  const [days, setDays] = useState([1, 2, 3, 4, 5, 6, 7].map(() => makeDay()));
  const [forecast, setForecast] = useState<Record<string, any>>({});
  const [fxStatus, setFxStatus] = useState("idle");

  const [meals, setMeals] = useState<Record<string, any>>({});
  const [staples, setStaples] = useState(DEFAULT_STAPLES);
  const [pantry, setPantry] = useState<string[]>([]);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [defaultPeople, setDefaultPeople] = useState(4);
  const [efficiency, setEfficiency] = useState(true);
  const [mixCuisines, setMixCuisines] = useState(true);
  const [busy, setBusy] = useState(false);

  const [rotation, setRotation] = useState<any[]>([]);
  const [liked, setLiked] = useState<string[]>([]);
  const [avoid, setAvoid] = useState<string[]>([]);

  /* ---- persistence (localStorage) ---- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        setLocation(d.location ?? DEFAULT_LOCATION);
        setStartDate(d.startDate ?? isoToday());
        setNumDays(d.numDays ?? 7);
        setDays(d.days ?? days);
        setForecast(d.forecast ?? {});
        setMeals(d.meals ?? {});
        setStaples(d.staples ?? DEFAULT_STAPLES);
        setPantry(d.pantry ?? []);
        setDefaultPeople(d.defaultPeople ?? 4);
        setEfficiency(d.efficiency ?? true);
        setMixCuisines(d.mixCuisines ?? true);
        setRotation(d.rotation ?? []);
        setLiked(d.liked ?? []);
        setAvoid(d.avoid ?? []);
      }
    } catch {}
    setLoaded(true);
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        location, startDate, numDays, days, forecast, meals, staples, pantry,
        defaultPeople, efficiency, mixCuisines, rotation, liked, avoid,
      }));
    } catch {}
  }, [location, startDate, numDays, days, forecast, meals, staples, pantry, defaultPeople, efficiency, mixCuisines, rotation, liked, avoid, loaded]);

  /* ---- keep day array length synced ---- */
  useEffect(() => {
    setDays((prev) => {
      if (prev.length === numDays) return prev;
      if (prev.length < numDays) return [...prev, ...Array.from({ length: numDays - prev.length }, () => makeDay(defaultPeople))];
      return prev.slice(0, numDays);
    });
  }, [numDays]); // eslint-disable-line

  const dateFor = useCallback((i: number) => addDays(startDate, i), [startDate]);

  /* ---- weather (Open-Meteo direct, keyless) ---- */
  const loadForecast = useCallback(async () => {
    setFxStatus("loading");
    try {
      const end = addDays(startDate, numDays - 1);
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat}&longitude=${location.lon}&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit&timezone=auto&start_date=${startDate}&end_date=${end}`;
      const r = await fetch(url);
      const j = await r.json();
      const map: Record<string, any> = {};
      if (j.daily && j.daily.time) {
        j.daily.time.forEach((t: string, i: number) => {
          map[t] = { hi: Math.round(j.daily.temperature_2m_max[i]), lo: Math.round(j.daily.temperature_2m_min[i]), code: j.daily.weather_code[i] };
        });
      }
      setForecast(map);
      setFxStatus(Object.keys(map).length ? "ok" : "error");
    } catch {
      setFxStatus("error");
    }
  }, [location, startDate, numDays]);

  useEffect(() => { if (loaded) loadForecast(); }, [loaded, location, startDate, numDays]); // eslint-disable-line

  const geocode = async (name: string) => {
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`);
      const j = await r.json();
      if (j.results && j.results[0]) {
        const g = j.results[0];
        setLocation({ name: `${g.name}${g.admin1 ? ", " + g.admin1 : ""}`, lat: g.latitude, lon: g.longitude });
      }
    } catch {}
  };

  /* ---- day ops ---- */
  const updDay = (id: string, patch: any) => setDays((p) => p.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const setEveryonePeople = (n: number) => { setDefaultPeople(n); setDays((p) => p.map((d) => ({ ...d, people: n }))); };

  /* ---- meal generation (via /api/generate proxy) ---- */
  const callClaude = async (prompt: string) => {
    const r = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await r.json();
    if (!r.ok) {
      // Anthropic errors arrive as { type, error: { type, message } }
      const msg = data?.error?.message ?? data?.error ?? `API error ${r.status}`;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    const text = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    const obj = JSON.parse(text.replace(/```json/gi, "").replace(/```/g, "").trim());
    if (!obj.name || !Array.isArray(obj.ingredients)) throw new Error("bad shape");
    obj.ingredients = obj.ingredients.map((i: any) => ({
      name: String(i.name || "").trim(), qty: Number(i.qty) || 0, unit: String(i.unit || "").trim(),
      category: CATEGORIES.includes(i.category) ? i.category : "Other",
    })).filter((i: any) => i.name);
    return obj;
  };

  const buildPrompt = (day: any, dateISO: string, committed: any[], usedCuisines: string[], reject?: string) => {
    const fx = forecast[dateISO];
    const band = tempBand(fx?.hi);
    const wlabel = fx ? `Forecast for ${weekdayLabel(dateISO)}: high ${fx.hi}F, low ${fx.lo}F, ${wx(fx.code).l}.` : `Date: ${weekdayLabel(dateISO)} (no forecast available).`;

    let tempGuide;
    if (day.temp === "Hot") tempGuide = "Make it a warm, hot dish.";
    else if (day.temp === "Cold") tempGuide = "Make it a cold or room-temp dish (salad, wrap, chilled).";
    else if (day.temp === "Either") tempGuide = "Hot or cold is fine.";
    else tempGuide = band === "hot" ? "It will be hot out -- favor a light, cooling, no-cook or quick-grill dinner."
      : band === "cold" ? "It will be cold out -- favor a warm, hearty, comforting dinner."
      : "Mild weather -- hot or cold both work.";

    const cuisineGuide = (day.cuisine && day.cuisine !== "Any")
      ? `Cuisine must be: ${day.cuisine}.`
      : mixCuisines
        ? `Choose a cuisine that adds VARIETY to the week. Cuisines already used this week: ${usedCuisines.length ? usedCuisines.join(", ") : "none"}. Pick a DIFFERENT one.`
        : `Any cuisine is fine.`;

    const prior = committed.length
      ? committed.map((m) => `- ${m.name}: ${m.ingredients.map((i: any) => `${i.name} (${i.qty}${i.unit ? " " + i.unit : ""})`).join(", ")}`).join("\n")
      : "none yet";

    const eff = efficiency
      ? `Efficiency rules:
- Mainstream, affordable ALDI ingredients.
- Share ingredients across the week; minimize waste.
- The family likes bulk chicken breasts poached with onion+garlic then shredded for multiple dinners. Favor this kind of batch prep.
- If a whole chicken is used, use its parts across more than one dinner.
- AVOID DOUBLE BUYING: if this dinner reuses an ingredient already bought below, do NOT list it again in "ingredients"; note it in "reuseNote".`
      : `Use mainstream, affordable ALDI ingredients.`;

    const loves = Array.from(new Set([...liked, ...rotation.map((r) => r.name)]));
    const prefLines: string[] = [];
    if (loves.length) prefLines.push(`The family LIKED these before (lean toward this style, keep variety): ${loves.slice(0, 12).join(", ")}.`);
    if (avoid.length) prefLines.push(`AVOID these (disliked): ${avoid.slice(0, 12).join(", ")}.`);

    return `You are a practical weekly dinner planner for a family that shops at ALDI. Generate ONE dinner only (breakfast and lunch are covered by staples).

${wlabel}
People eating: ${day.people}
${tempGuide}
${cuisineGuide}
${day.note ? `Extra request: ${day.note}` : ""}
${prefLines.join("\n")}

${eff}
- Do NOT repeat a main dish already planned this week.
${reject ? `\nThe user REJECTED "${reject}". Propose a clearly DIFFERENT dinner (different main and ideally different cuisine).` : ""}

Dinners already planned this week (with purchased ingredients):
${prior}

Respond with ONLY one JSON object -- no markdown, no fences, no commentary -- exactly:
{"name":"","description":"one short sentence","cuisine":"","servings":${day.people},"reuseNote":"","ingredients":[{"name":"","qty":0,"unit":"","category":"Produce|Meat & Seafood|Dairy & Eggs|Pantry|Frozen|Bakery|Other"}]}`;
  };

  const committedData = (excludeId?: string) => days
    .filter((d) => d.id !== excludeId)
    .map((d) => meals[d.id])
    .filter((m) => m && (m.status === "accepted" || m.status === "ready"))
    .map((m) => m.data);

  const usedCuisinesFrom = (data: any[]) => Array.from(new Set(data.map((m) => m.cuisine).filter(Boolean)));

  const generateOne = async (day: any, idx: number, committed: any[], reject?: string) => {
    setMeals((m) => ({ ...m, [day.id]: { status: "loading", data: null, error: null } }));
    try {
      const data = await callClaude(buildPrompt(day, dateFor(idx), committed, usedCuisinesFrom(committed), reject));
      setMeals((m) => ({ ...m, [day.id]: { status: "ready", data, error: null } }));
      return data;
    } catch (e: any) {
      setMeals((m) => ({ ...m, [day.id]: { status: "error", data: null, error: e?.message || "Couldn't generate -- retry." } }));
      return null;
    }
  };

  const generateAll = async () => {
    setBusy(true); setTab("plan");
    const committed = days.map((d) => meals[d.id]).filter((m) => m && m.status === "accepted").map((m) => m.data);
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      if (meals[day.id]?.status === "accepted") continue;
      const data = await generateOne(day, i, [...committed]);
      if (data) committed.push(data);
    }
    setBusy(false);
  };

  const acceptMeal = (id: string) => setMeals((m) => ({ ...m, [id]: { ...m[id], status: "accepted" } }));
  const rejectMeal = async (day: any, idx: number) => { await generateOne(day, idx, committedData(day.id), meals[day.id]?.data?.name); };

  const thumbUp = (name: string) => { if (name) setLiked((p) => (p.includes(name) ? p : [...p, name])); };
  const thumbDown = async (day: any, idx: number) => {
    const name = meals[day.id]?.data?.name;
    if (name) { setAvoid((p) => (p.includes(name) ? p : [...p, name])); setLiked((p) => p.filter((x) => x !== name)); }
    await rejectMeal(day, idx);
  };
  const addToRotation = (data: any) => { setRotation((p) => (p.some((r) => r.name === data.name) ? p : [...p, data])); thumbUp(data.name); };

  /* ---- grocery list ---- */
  const acceptedCount = useMemo(() => days.filter((d) => meals[d.id]?.status === "accepted").length, [days, meals]);

  const groceryList = useMemo(() => {
    const agg: Record<string, any> = {};
    const push = (name: string, qty: number, unit: string, category: string) => {
      const key = `${name.toLowerCase()}|${unit.toLowerCase()}`;
      if (!agg[key]) agg[key] = { name, qty: 0, unit, category: CATEGORIES.includes(category) ? category : "Other", staple: false };
      agg[key].qty += Number(qty) || 0;
    };
    days.forEach((d) => { const m = meals[d.id]; if (m?.status === "accepted") m.data.ingredients.forEach((i: any) => push(i.name, i.qty, i.unit, i.category)); });
    staples.filter((st) => st.enabled).forEach((st) => { const k = `${st.name.toLowerCase()}|${st.unit.toLowerCase()}`; push(st.name, st.qty, st.unit, st.category); if (agg[k]) agg[k].staple = true; });
    const byCat: Record<string, any[]> = {}; CATEGORIES.forEach((c) => (byCat[c] = []));
    Object.values(agg).forEach((it: any) => { if (pantry.includes(it.name.toLowerCase())) return; (byCat[it.category] || byCat.Other).push(it); });
    CATEGORIES.forEach((c) => byCat[c].sort((a, b) => a.name.localeCompare(b.name)));
    return byCat;
  }, [days, meals, staples, pantry]);

  const totalItems = useMemo(() => Object.values(groceryList).reduce((n, a) => n + a.length, 0), [groceryList]);
  const listText = useMemo(() => {
    const lines: string[] = [];
    CATEGORIES.forEach((cat) => {
      const items = groceryList[cat]; if (!items?.length) return;
      lines.push(`${cat}:`);
      items.forEach((it: any) => { const q = Number.isInteger(it.qty) ? it.qty : Math.round(it.qty * 100) / 100; lines.push(`  - ${it.name} (${it.unit ? `${q} ${it.unit}` : q})`); });
      lines.push("");
    });
    return lines.join("\n").trim();
  }, [groceryList]);

  if (!loaded) return <div style={s.shell}><p style={{ fontFamily: serif, color: "#5b6b5e" }}>Loading your kitchen...</p></div>;

  return (
    <div style={s.shell}>
      <style>{fontImport}</style>
      <header style={s.header}>
        <div style={s.logoRow}>
          <div style={s.logoMark}><Utensils size={20} color="#fff" /></div>
          <div>
            <h1 style={s.h1}>ALLDEEZMeals</h1>
            <p style={s.sub}>Weather-aware dinners - learns your taste - ALDI list</p>
          </div>
        </div>
      </header>

      <nav style={s.tabs}>
        <TabBtn active={tab === "setup"} onClick={() => setTab("setup")} icon={<Settings2 size={15} />} label="Setup" />
        <TabBtn active={tab === "plan"} onClick={() => setTab("plan")} icon={<Sparkles size={15} />} label={`Meals (${acceptedCount}/${days.length})`} />
        <TabBtn active={tab === "list"} onClick={() => setTab("list")} icon={<ListChecks size={15} />} label={`List (${totalItems})`} />
        <TabBtn active={tab === "rotation"} onClick={() => setTab("rotation")} icon={<Star size={15} />} label={`Saved (${rotation.length})`} />
      </nav>

      <main style={s.main}>
        {tab === "setup" && (
          <SetupView
            location={location} geocode={geocode}
            startDate={startDate} setStartDate={setStartDate}
            numDays={numDays} setNumDays={setNumDays}
            days={days} updDay={updDay} dateFor={dateFor} forecast={forecast} fxStatus={fxStatus}
            defaultPeople={defaultPeople} setDefaultPeople={setEveryonePeople}
            efficiency={efficiency} setEfficiency={setEfficiency}
            mixCuisines={mixCuisines} setMixCuisines={setMixCuisines}
            staples={staples} setStaples={setStaples}
            onGenerate={generateAll} busy={busy}
          />
        )}
        {tab === "plan" && (
          <PlanView
            days={days} meals={meals} busy={busy} dateFor={dateFor} forecast={forecast}
            onAccept={acceptMeal} onReject={rejectMeal}
            onThumbUp={(d: any) => thumbUp(meals[d.id]?.data?.name)} onThumbDown={thumbDown}
            onAddRotation={(d: any) => addToRotation(meals[d.id].data)}
            liked={liked} onGenerate={generateAll}
          />
        )}
        {tab === "list" && (
          <ListView groceryList={groceryList} totalItems={totalItems} listText={listText}
            pantry={pantry} setPantry={setPantry} checkedItems={checkedItems} setCheckedItems={setCheckedItems}
            acceptedCount={acceptedCount} slotCount={days.length} />
        )}
        {tab === "rotation" && (
          <RotationView rotation={rotation} setRotation={setRotation} liked={liked} setLiked={setLiked} avoid={avoid} setAvoid={setAvoid} />
        )}
      </main>
    </div>
  );
}

/* ============================ Setup ============================ */
function SetupView(p: any) {
  const { location, geocode, startDate, setStartDate, numDays, setNumDays, days, updDay, dateFor, forecast, fxStatus,
    defaultPeople, setDefaultPeople, efficiency, setEfficiency, mixCuisines, setMixCuisines, staples, setStaples, onGenerate, busy } = p;
  const [showStaples, setShowStaples] = useState(false);
  const [locInput, setLocInput] = useState("");

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={s.card}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 150 }}>
            <label style={s.fieldLabel}><CalendarDays size={12} style={{ verticalAlign: -2 }} /> Start date</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ ...s.input, width: "100%" }} />
          </div>
          <div style={{ width: 78 }}>
            <label style={s.fieldLabel}>Days</label>
            <select value={numDays} onChange={(e) => setNumDays(Number(e.target.value))} style={{ ...s.input, width: "100%" }}>
              {[3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div style={{ width: 64 }}>
            <label style={s.fieldLabel}>People</label>
            <input type="number" min={1} value={defaultPeople} onChange={(e) => setDefaultPeople(Math.max(1, Number(e.target.value) || 1))} style={{ ...s.input, width: "100%", textAlign: "center" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
          <MapPin size={14} color="#7a8a7c" />
          <span style={{ fontSize: 13, color: "#5b6b5e" }}>{location.name}</span>
          <input value={locInput} onChange={(e) => setLocInput(e.target.value)} placeholder="change location" style={{ ...s.input, flex: 1, fontSize: 12.5, padding: "6px 9px" }}
            onKeyDown={(e) => { if (e.key === "Enter" && locInput.trim()) { geocode(locInput.trim()); setLocInput(""); } }} />
          <span style={s.miniLabel}>{fxStatus === "loading" ? "loading wx..." : fxStatus === "error" ? "wx unavailable" : ""}</span>
        </div>
      </div>

      <div style={s.card}>
        <h3 style={s.cardTitle}>Your week</h3>
        <p style={s.cardSub}>Forecast auto-fills. Temp = Auto adapts the dish to the weather.</p>
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          {days.map((day: any, i: number) => {
            const date = dateFor(i); const fx = forecast[date]; const w = fx ? wx(fx.code) : null;
            return (
              <div key={day.id} style={s.dayBlock}>
                <div style={s.dayHeadRow}>
                  <span style={s.dayDate}>{weekdayLabel(date)}</span>
                  {fx ? <span style={s.fxChip}>{w!.e} {fx.hi}/{fx.lo}F - {w!.l}</span> : <span style={s.fxChipMuted}>no forecast</span>}
                </div>
                <div style={s.slotRow}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input type="number" min={1} value={day.people} onChange={(e) => updDay(day.id, { people: Math.max(1, Number(e.target.value) || 1) })} style={{ ...s.input, width: 50, textAlign: "center" }} />
                    <span style={s.miniLabel}>ppl</span>
                  </div>
                  <select value={day.cuisine} onChange={(e) => updDay(day.id, { cuisine: e.target.value })} style={{ ...s.input, flex: 1, minWidth: 100 }}>{CUISINES.map((c) => <option key={c}>{c}</option>)}</select>
                  <select value={day.temp} onChange={(e) => updDay(day.id, { temp: e.target.value })} style={{ ...s.input, width: 82 }}>{TEMPS.map((t) => <option key={t}>{t}</option>)}</select>
                </div>
                <input value={day.note} onChange={(e) => updDay(day.id, { note: e.target.value })} placeholder="optional note" style={{ ...s.input, fontSize: 12.5, marginTop: 6, width: "100%" }} />
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
                <button onClick={() => setStaples((q: any[]) => q.filter((x) => x.id !== st.id))} style={s.iconBtn}><X size={14} color="#a23b3b" /></button>
              </div>
            ))}
            <button onClick={() => setStaples((q: any[]) => [...q, { id: uid(), name: "", qty: 1, unit: "", category: "Pantry", enabled: true }])} style={{ ...s.addBtn, marginTop: 4 }}><Plus size={15} /> Add staple</button>
          </div>
        )}
      </div>

      <button onClick={onGenerate} disabled={busy} style={{ ...s.primaryBtn, justifyContent: "center", padding: 14, fontSize: 15, opacity: busy ? 0.6 : 1 }}>
        {busy ? <><RefreshCw size={17} className="spin" /> Generating...</> : <><Sparkles size={17} /> Generate meal plan</>}
      </button>
    </div>
  );
}

/* ============================ Plan ============================ */
function PlanView({ days, meals, busy, dateFor, forecast, onAccept, onReject, onThumbUp, onThumbDown, onAddRotation, liked, onGenerate }: any) {
  if (!days.some((d: any) => meals[d.id])) {
    return <div style={s.card}><p style={s.empty}>No meals yet.</p><button onClick={onGenerate} disabled={busy} style={{ ...s.primaryBtn, marginTop: 12 }}><Sparkles size={16} /> Generate meal plan</button></div>;
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {days.map((day: any, i: number) => {
        const m = meals[day.id]; const date = dateFor(i); const fx = forecast[date]; const w = fx ? wx(fx.code) : null;
        const isLiked = m?.data && liked.includes(m.data.name);
        return (
          <div key={day.id} style={s.mealCard}>
            <div style={s.mealTop}>
              <span style={s.slotTag}>{weekdayLabel(date)} - {day.people} ppl{fx ? ` - ${w!.e} ${fx.hi}F` : ""}</span>
            </div>
            {!m && <p style={s.empty}>Not generated.</p>}
            {m?.status === "loading" && <p style={{ ...s.empty, display: "flex", gap: 8, alignItems: "center" }}><RefreshCw size={15} className="spin" /> Thinking up a dish...</p>}
            {m?.status === "error" && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#a23b3b", fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}><AlertCircle size={15} /> {m.error}</span>
                <button onClick={() => onReject(day, i)} style={s.ghostBtn}><RefreshCw size={14} /> Retry</button>
              </div>
            )}
            {m?.data && (m.status === "ready" || m.status === "accepted") && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ flex: 1 }}>
                    <h3 style={s.mealName}>{m.data.name}</h3>
                    <p style={s.mealDesc}>{m.data.cuisine ? <span style={s.cuisineTag}>{m.data.cuisine}</span> : null} {m.data.description}</p>
                  </div>
                  {m.status === "accepted" && <span style={s.acceptedPill}><Check size={13} /> Accepted</span>}
                </div>
                {m.data.reuseNote && <div style={s.reuseNote}><Repeat size={13} /> {m.data.reuseNote}</div>}
                <div style={s.tagWrap}>
                  {m.data.ingredients.map((ing: any, idx: number) => (
                    <span key={idx} style={s.tag}>{ing.name}{ing.qty ? ` - ${Number.isInteger(ing.qty) ? ing.qty : Math.round(ing.qty * 100) / 100}${ing.unit ? " " + ing.unit : ""}` : ""}</span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
                  {m.status !== "accepted" && <button onClick={() => onAccept(day.id)} style={s.acceptBtn}><Check size={15} /> Accept</button>}
                  <button onClick={() => onReject(day, i)} style={s.rejectBtn}><RefreshCw size={14} /> {m.status === "accepted" ? "Swap" : "Reject"}</button>
                  <div style={{ flex: 1 }} />
                  <button onClick={() => onThumbUp(day)} style={{ ...s.thumb, color: isLiked ? "#3d5141" : "#9aa89c", borderColor: isLiked ? "#3d5141" : "#d8ddd4" }} title="Like"><ThumbsUp size={15} /></button>
                  <button onClick={() => onThumbDown(day, i)} style={{ ...s.thumb, color: "#a23b3b", borderColor: "#e6cccc" }} title="Dislike (avoid + swap)"><ThumbsDown size={15} /></button>
                  <button onClick={() => onAddRotation(day)} style={s.rotateBtn} title="Save to rotation"><Star size={14} /> Rotation</button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ============================ List ============================ */
function ListView({ groceryList, totalItems, listText, pantry, setPantry, checkedItems, setCheckedItems, acceptedCount, slotCount }: any) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(listText); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {} };
  const togglePantry = (n: string) => { const k = n.toLowerCase(); setPantry((p: string[]) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]); };
  const toggleCheck = (k: string) => setCheckedItems((p: any) => ({ ...p, [k]: !p[k] }));
  return (
    <div>
      <div style={s.listToolbar}>
        <p style={s.cardSub}>{totalItems} items - {acceptedCount}/{slotCount} dinners + staples</p>
        <button onClick={copy} style={s.primaryBtn}>{copied ? <CheckCircle2 size={16} /> : <Copy size={16} />} {copied ? "Copied!" : "Copy list"}</button>
      </div>
      {totalItems === 0 ? <div style={s.card}><p style={s.empty}>Accept dinners to build the list (staples always included).</p></div> : (
        <div style={{ display: "grid", gap: 14 }}>
          {CATEGORIES.map((cat) => {
            const items = groceryList[cat]; if (!items?.length) return null;
            return (
              <div key={cat} style={s.card}>
                <h3 style={s.catTitle}>{cat}</h3>
                <div style={{ display: "grid", gap: 4 }}>
                  {items.map((it: any) => {
                    const key = `${it.name}|${it.unit}`; const checked = !!checkedItems[key]; const isP = pantry.includes(it.name.toLowerCase());
                    const q = Number.isInteger(it.qty) ? it.qty : Math.round(it.qty * 100) / 100;
                    return (
                      <div key={key} style={s.listItem}>
                        <button onClick={() => toggleCheck(key)} style={{ ...s.check, background: checked ? "#3d5141" : "transparent" }}>{checked && <Check size={13} color="#fff" />}</button>
                        <span style={{ flex: 1, textDecoration: checked ? "line-through" : "none", color: checked ? "#9aa89c" : "#2c3a2e" }}>
                          {it.name} <span style={s.qtyText}>- {it.unit ? `${q} ${it.unit}` : q}</span>{it.staple && <span style={s.stapleDot}>staple</span>}
                        </span>
                        <button onClick={() => togglePantry(it.name)} style={{ ...s.pantryBtn, color: isP ? "#3d5141" : "#b6c0b7", borderColor: isP ? "#3d5141" : "#d8ddd4" }}>have it</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div style={s.howto}>
        <h4 style={s.howtoTitle}>Order from ALDI (free)</h4>
        <ol style={s.howtoList}><li>Tap <strong>Copy list</strong>.</li><li>Open the <strong>ALDI app</strong> (or ChatGPT + Instacart) and add items.</li><li>Pick delivery or curbside and check out.</li></ol>
      </div>
    </div>
  );
}

/* ============================ Rotation ============================ */
function RotationView({ rotation, setRotation, liked, setLiked, avoid, setAvoid }: any) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={s.card}>
        <h3 style={s.cardTitle}>Rotation <span style={s.cardSub}>- saved favorites the planner leans toward</span></h3>
        {rotation.length === 0 ? <p style={{ ...s.empty, marginTop: 8 }}>Tap "Rotation" on a meal you love to save it here.</p> : (
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {rotation.map((r: any, i: number) => (
              <div key={i} style={s.rotItem}>
                <div><div style={{ fontWeight: 700, fontSize: 14 }}>{r.name}</div><div style={s.cardSub}>{r.cuisine} - {r.ingredients.length} ingredients</div></div>
                <button onClick={() => setRotation((p: any[]) => p.filter((_, idx) => idx !== i))} style={s.iconBtn}><Trash2 size={15} color="#a23b3b" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={s.card}><h3 style={s.cardTitle}>Liked styles</h3><ChipManager items={liked} onRemove={(x: string) => setLiked((p: string[]) => p.filter((i) => i !== x))} empty="Thumbs-up meals show up here." tone="green" /></div>
      <div style={s.card}><h3 style={s.cardTitle}>Avoiding</h3><ChipManager items={avoid} onRemove={(x: string) => setAvoid((p: string[]) => p.filter((i) => i !== x))} empty="Thumbs-down meals get added here." tone="red" /></div>
    </div>
  );
}
function ChipManager({ items, onRemove, empty, tone }: any) {
  if (!items.length) return <p style={{ ...s.empty, marginTop: 8 }}>{empty}</p>;
  return (
    <div style={{ ...s.tagWrap, marginTop: 10 }}>
      {items.map((x: string, i: number) => (
        <span key={i} style={{ ...s.tag, ...(tone === "red" ? { background: "#fbeaea", color: "#a23b3b" } : {}), display: "inline-flex", gap: 5, alignItems: "center" }}>
          {x}<button onClick={() => onRemove(x)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "grid" }}><X size={12} /></button>
        </span>
      ))}
    </div>
  );
}

/* ============================ bits + styles ============================ */
function TabBtn({ active, onClick, icon, label }: any) {
  return <button onClick={onClick} style={{ ...s.tab, ...(active ? s.tabActive : {}) }}>{icon}<span>{label}</span></button>;
}

const fontImport = `@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Nunito+Sans:wght@400;600;700&display=swap');
.spin{animation:sp 1s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}`;
const serif = "'Fraunces', Georgia, serif";
const sans = "'Nunito Sans', -apple-system, sans-serif";

const s: Record<string, any> = {
  shell: { fontFamily: sans, background: "#f4f1e9", minHeight: "100%", color: "#2c3a2e", padding: 20, maxWidth: 780, margin: "0 auto" },
  header: { marginBottom: 18 }, logoRow: { display: "flex", alignItems: "center", gap: 12 },
  logoMark: { width: 40, height: 40, borderRadius: 11, background: "#3d5141", display: "grid", placeItems: "center", boxShadow: "0 2px 6px rgba(61,81,65,.3)" },
  h1: { fontFamily: serif, fontSize: 23, fontWeight: 600, margin: 0, letterSpacing: "-.01em" },
  sub: { margin: "2px 0 0", fontSize: 12.5, color: "#7a8a7c" },
  tabs: { display: "flex", gap: 5, marginBottom: 18, background: "#e8e3d6", padding: 5, borderRadius: 12 },
  tab: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 4px", border: "none", borderRadius: 9, background: "transparent", color: "#6b7a6d", fontFamily: sans, fontWeight: 600, fontSize: 12, cursor: "pointer" },
  tabActive: { background: "#fff", color: "#2c3a2e", boxShadow: "0 1px 3px rgba(0,0,0,.08)" },
  main: { paddingBottom: 40 },
  card: { background: "#fff", borderRadius: 13, padding: 16, border: "1px solid #e6e2d6" },
  cardTitle: { fontFamily: serif, fontSize: 16.5, fontWeight: 600, margin: 0 },
  cardSub: { fontSize: 12.5, color: "#7a8a7c", margin: "2px 0 0", fontWeight: 400 },
  miniLabel: { fontSize: 11, color: "#7a8a7c" },
  fieldLabel: { fontSize: 11, fontWeight: 700, color: "#6b7a6d", textTransform: "uppercase", letterSpacing: ".04em", display: "block", marginBottom: 5 },
  slotRow: { display: "flex", gap: 6, alignItems: "center" },
  dayBlock: { background: "#faf8f2", border: "1px solid #ece7d9", borderRadius: 10, padding: 11 },
  dayHeadRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  dayDate: { fontFamily: serif, fontSize: 14.5, fontWeight: 600, color: "#2c3a2e" },
  fxChip: { fontSize: 11.5, fontWeight: 600, color: "#52614f", background: "#eef2e9", borderRadius: 14, padding: "3px 10px" },
  fxChipMuted: { fontSize: 11.5, color: "#b6c0b7", fontStyle: "italic" },
  toggleRow: { display: "flex", gap: 10, alignItems: "flex-start", background: "#eef2e9", border: "1px solid #d3ddc9", borderRadius: 12, padding: 13, fontSize: 13.5, cursor: "pointer", lineHeight: 1.45 },
  collapseBtn: { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "transparent", border: "none", cursor: "pointer", fontSize: 14, color: "#2c3a2e", fontFamily: sans },
  input: { padding: "9px 10px", border: "1px solid #d8ddd4", borderRadius: 8, fontFamily: sans, fontSize: 13, color: "#2c3a2e", boxSizing: "border-box", background: "#fff" },
  addBtn: { display: "inline-flex", alignItems: "center", gap: 5, background: "#eef2e9", color: "#3d5141", border: "1px solid #d3ddc9", borderRadius: 8, padding: "7px 12px", fontFamily: sans, fontWeight: 700, fontSize: 12.5, cursor: "pointer" },
  primaryBtn: { display: "inline-flex", alignItems: "center", gap: 7, background: "#3d5141", color: "#fff", border: "none", borderRadius: 9, padding: "10px 16px", fontFamily: sans, fontWeight: 700, fontSize: 14, cursor: "pointer", boxShadow: "0 2px 5px rgba(61,81,65,.25)" },
  ghostBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "#6b7a6d", border: "1px solid #d8ddd4", borderRadius: 9, padding: "8px 13px", fontFamily: sans, fontWeight: 600, fontSize: 13, cursor: "pointer" },
  iconBtn: { background: "transparent", border: "none", cursor: "pointer", padding: 5, borderRadius: 6, display: "grid", placeItems: "center" },
  mealCard: { background: "#fff", borderRadius: 13, padding: 16, border: "1px solid #e6e2d6" },
  mealTop: { marginBottom: 8 },
  slotTag: { fontSize: 11.5, fontWeight: 700, color: "#7a8a7c", textTransform: "uppercase", letterSpacing: ".04em" },
  mealName: { fontFamily: serif, fontSize: 18, fontWeight: 600, margin: 0, color: "#2c3a2e" },
  mealDesc: { fontSize: 13.5, color: "#5b6b5e", margin: "4px 0 0", lineHeight: 1.45 },
  cuisineTag: { display: "inline-block", fontSize: 10.5, fontWeight: 700, color: "#3d5141", background: "#eef2e9", padding: "1px 7px", borderRadius: 10, marginRight: 4, textTransform: "uppercase", letterSpacing: ".03em" },
  acceptedPill: { display: "inline-flex", alignItems: "center", gap: 4, background: "#3d5141", color: "#fff", fontSize: 11.5, fontWeight: 700, padding: "4px 9px", borderRadius: 20, whiteSpace: "nowrap" },
  reuseNote: { display: "flex", alignItems: "center", gap: 6, background: "#fdf3e3", border: "1px solid #f0dcb8", color: "#8a6d3b", fontSize: 12.5, padding: "7px 11px", borderRadius: 8, marginTop: 10 },
  tagWrap: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 11 },
  tag: { background: "#eef2e9", color: "#52614f", fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 20 },
  acceptBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "#3d5141", color: "#fff", border: "none", borderRadius: 8, padding: "8px 15px", fontFamily: sans, fontWeight: 700, fontSize: 13, cursor: "pointer" },
  rejectBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", color: "#a23b3b", border: "1px solid #e6cccc", borderRadius: 8, padding: "8px 14px", fontFamily: sans, fontWeight: 700, fontSize: 13, cursor: "pointer" },
  thumb: { display: "grid", placeItems: "center", width: 34, height: 34, background: "#fff", border: "1px solid", borderRadius: 8, cursor: "pointer" },
  rotateBtn: { display: "inline-flex", alignItems: "center", gap: 5, background: "#fdf6e8", color: "#8a6d3b", border: "1px solid #f0dcb8", borderRadius: 8, padding: "7px 11px", fontFamily: sans, fontWeight: 700, fontSize: 12.5, cursor: "pointer" },
  empty: { color: "#9aa89c", fontSize: 13.5, fontStyle: "italic", margin: 0 },
  listToolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 10 },
  catTitle: { fontFamily: serif, fontSize: 15, fontWeight: 600, margin: "0 0 8px", color: "#3d5141", borderBottom: "1px solid #eee7d8", paddingBottom: 6 },
  listItem: { display: "flex", alignItems: "center", gap: 10, padding: "5px 0", fontSize: 14 },
  check: { width: 20, height: 20, borderRadius: 6, border: "1.5px solid #b6c0b7", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 },
  qtyText: { color: "#9aa89c", fontSize: 12.5 },
  stapleDot: { marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#8a6d3b", background: "#fdf3e3", padding: "1px 6px", borderRadius: 10 },
  pantryBtn: { fontSize: 11, fontWeight: 700, border: "1px solid", background: "transparent", borderRadius: 14, padding: "2px 9px", cursor: "pointer" },
  rotItem: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#faf8f2", border: "1px solid #ece7d9", borderRadius: 9, padding: "10px 12px" },
  howto: { marginTop: 22, background: "#eef2e9", borderRadius: 13, padding: "14px 18px", border: "1px solid #d3ddc9" },
  howtoTitle: { fontFamily: serif, fontSize: 15, fontWeight: 600, margin: "0 0 6px", color: "#3d5141" },
  howtoList: { margin: 0, paddingLeft: 18, fontSize: 13, color: "#52614f", lineHeight: 1.7 },
};
