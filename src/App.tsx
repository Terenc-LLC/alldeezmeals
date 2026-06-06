import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Plus, Trash2, X, Check, Copy, Sparkles, RefreshCw, Settings2,
  ListChecks, CheckCircle2, AlertCircle, Repeat, Info,
  ThumbsUp, ThumbsDown, Star, MapPin, CalendarDays, LogOut, Archive,
  ReceiptText, HelpCircle, Clock, Users, Flame, Printer, ShoppingCart,
  MessageSquare, ChevronLeft, ChevronRight,
} from "lucide-react";
import { supabase } from "./supabase";
import { normalizeIngName } from "./lib/normalize";
import { resolveNutrition, USDA_ATTRIBUTION, type NutritionResult } from "./lib/nutritionResolve";
import { buildInstacartHandoff } from "./lib/instacart-handoff";

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
const DIFFICULTY_LABELS = ["Premade", "Minimal", "Simple", "Moderate", "Involved", "Intricate"] as const;
const EFFORT_LEVELS: { key: string; label: string; min: number; max: number }[] = [
  { key: "any",      label: "Any effort",             min: 0, max: 5 },
  { key: "easy",     label: "Easy (Premade–Minimal)", min: 0, max: 1 },
  { key: "simple",   label: "Simple or less",         min: 0, max: 2 },
  { key: "moderate", label: "Moderate",               min: 2, max: 3 },
  { key: "involved", label: "Involved+",              min: 4, max: 5 },
];

const DEFAULT_LOCATION = { name: "Bloomfield, IA", lat: 40.7517, lon: -92.4154 };

const DEFAULT_STAPLES: any[] = [];

/* ---- date helpers ---- */
const isoToday = () => toISO(new Date());
function toISO(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function parseISO(s: string) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(iso: string, n: number) { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
function weekdayLabel(iso: string) { return parseISO(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }

/* ---- WMO weather code -> label/emoji ---- */
function wx(code: number) {
  if (code === 0) return { e: "☀️", l: "Clear" };
  if (code <= 3) return { e: "⛅", l: "Partly cloudy" };
  if (code <= 48) return { e: "🌫️", l: "Fog" };
  if (code <= 57) return { e: "🌦️", l: "Drizzle" };
  if (code <= 67) return { e: "🌧️", l: "Rain" };
  if (code <= 77) return { e: "❄️", l: "Snow" };
  if (code <= 82) return { e: "🌦️", l: "Showers" };
  if (code <= 86) return { e: "🌨️", l: "Snow showers" };
  return { e: "⛈️", l: "Thunderstorm" };
}
const tempBand = (hi: number | null | undefined) => (hi == null ? "mild" : hi >= 82 ? "hot" : hi <= 45 ? "cold" : "mild");

const makeDay = (people = 4) => ({ id: uid(), people, cuisine: "Any", temp: "Auto", effort: "any", note: "", pinnedRecipe: undefined as any, skip: false });

const round2 = (n: number) => Math.round(n * 100) / 100;

function scaleRecipeToHeadcount(recipe: any, dayPeople: number) {
  const denom = Number(recipe?.servings) > 0 ? Number(recipe.servings) : dayPeople;
  const factor = denom > 0 ? dayPeople / denom : 1;
  const ingredients = (recipe.ingredients ?? []).map((i: any) => ({
    ...i,
    recipeAmount: i.recipeAmount
      ? { qty: round2((Number(i.recipeAmount.qty) || 0) * factor), unit: i.recipeAmount.unit }
      : i.recipeAmount,
    purchaseQty: Math.max(1, Math.ceil((Number(i.purchaseQty) || 1) * factor)),
  }));
  return { ...recipe, servings: dayPeople, ingredients };
}

/* ---- display helpers ---- */
function fmtRecipeQty(ing: any): string {
  if (ing.recipeAmount) {
    const { qty, unit } = ing.recipeAmount;
    if (!qty) return "";
    const q = Number.isInteger(qty) ? qty : Math.round(qty * 100) / 100;
    return `${q}${unit ? " " + unit : ""}`;
  }
  if (!ing.qty) return "";
  const q = Number.isInteger(ing.qty) ? ing.qty : Math.round(ing.qty * 100) / 100;
  return `${q}${ing.unit ? " " + ing.unit : ""}`;
}

function fmtPurchaseQty(qty: number, unit: string, isPurchaseStyle: boolean): string {
  if (isPurchaseStyle) return qty <= 1 ? unit : `${qty} × ${unit}`;
  const q = Number.isInteger(qty) ? qty : Math.round(qty * 100) / 100;
  return unit ? `${q} ${unit}` : String(q);
}

function detectDietaryTerms(note: string): string[] {
  const n = note.toLowerCase();
  function hasAvoid(trigger: string): boolean {
    const t = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return (
      new RegExp(`\\bno\\s+${t}\\b`).test(n) ||
      new RegExp(`\\b${t}[\\s-]free\\b`).test(n) ||
      new RegExp(`\\bwithout\\s+${t}\\b`).test(n) ||
      new RegExp(`\\bfree\\s+of\\s+${t}\\b`).test(n) ||
      new RegExp(`\\ballergic\\s+to\\s+${t}\\b`).test(n) ||
      new RegExp(`\\b${t}\\s+allerg(?:y|ies|ic)\\b`).test(n) ||
      new RegExp(`\\bcan['']?t\\s+have\\s+${t}\\b`).test(n) ||
      new RegExp(`\\bcannot\\s+have\\s+${t}\\b`).test(n) ||
      new RegExp(`\\bskip\\s+(?:the\\s+)?${t}\\b`).test(n) ||
      new RegExp(`\\bhold\\s+the\\s+${t}\\b`).test(n)
    );
  }
  const TERMS: [string, string[]][] = [
    ["nuts",     ["nut", "nuts", "tree nut", "tree nuts", "treenut"]],
    ["peanuts",  ["peanut", "peanuts"]],
    ["dairy",    ["dairy", "milk", "lactose"]],
    ["eggs",     ["egg", "eggs"]],
    ["gluten",   ["gluten", "wheat"]],
    ["soy",      ["soy", "soya"]],
    ["shellfish",["shellfish", "shrimp", "crab", "lobster"]],
    ["fish",     ["fish"]],
    ["sesame",   ["sesame"]],
  ];
  return TERMS.filter(([, triggers]) => triggers.some(hasAvoid)).map(([canonical]) => canonical);
}

function dietaryDisclaimer(items: string[]): string {
  return `Generated to avoid: ${items.join(", ")} per your note. Verify every ingredient and package label yourself — not an allergen-safety guarantee.`;
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 480);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 480);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

// TER-358: extracted so buildSeedPrompt can share the exact same output contract as buildPrompt.
function recipeOutputContract(servings: number): string {
  return `Each ingredient requires: source ("buy"|"reused"|"staple"), recipeAmount {qty, unit} (cooking amount; required for buy & reused; optional for staple — use qty:0,unit:"to taste" if unmeasured). For source:"buy" only: purchaseSize (realistic ALDI package label, e.g. "1 head", "16 oz box", "2 lb bag", "1 dozen") and purchaseQty (integer ≥ 1, packages rounded UP to cover recipeAmount). For source:"reused" set purchaseSize:"" purchaseQty:0. For source:"staple" omit or zero purchaseSize/purchaseQty. preparedEarlier (boolean, default false): set to true ONLY if this ingredient was actually prepped/cooked in an EARLIER meal this week and is being reused in that prepared form (e.g. shredded chicken poached Monday, onions diced earlier). A whole/raw item pulled from a shared pack is NOT preparedEarlier (e.g. half an onion from the already-purchased bag → preparedEarlier:false). This field is independent of source.

Respond with ONLY one JSON object -- no markdown, no fences, no commentary. Include numbered step-by-step cooking instructions in "steps". Set realistic "prepMinutes" and "cookMinutes" integers. Set "estKcalPerServing" to your best integer estimate of kilocalories per serving for the given number of servings. Set "difficulty" to an integer 0–5 for total effort: 0=premade/heat-and-serve (no real prep), 1=minimal (assemble/microwave/toast), 2=simple one-pan/weeknight, 3=moderate (some technique or multiple components), 4=involved (multiple steps/timing), 5=intricate (advanced technique or long prep). Use 0–1 for occasional convenience nights. ORIGINALITY: write original recipes — original cooking directions and descriptions in your own words; do not copy text from published recipes. (Quantities/ingredient lists are fine; the written steps/description must be original.) SPECIFIC NAME: set "name" to a distinctive, specific dish name (e.g. "Ginger-Soy Chicken Stir Fry with Peppers"), NOT a generic category ("Chicken Stir Fry"). Exactly:
{"name":"","description":"one short sentence","cuisine":"","servings":${servings},"prepMinutes":0,"cookMinutes":0,"estKcalPerServing":0,"difficulty":0,"reuseNote":"","provenance":"","reuseNotes":[],"pantryNote":"","ingredients":[{"name":"","recipeAmount":{"qty":0,"unit":""},"source":"buy","preparedEarlier":false,"purchaseSize":"","purchaseQty":1,"category":"Produce|Meat & Seafood|Dairy & Eggs|Pantry|Frozen|Bakery|Other"}],"steps":["step 1","step 2","..."]}`;
}

async function generateRecipeFromPrompt(prompt: string, token: string): Promise<any> {
  const r = await fetch("/api/generate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ prompt, max_tokens: 5000 }),
  });
  const data = await r.json();
  if (!r.ok) {
    const msg = data?.error?.message ?? data?.error ?? `API error ${r.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  if (data.stop_reason === "max_tokens") {
    throw Object.assign(new Error("Response truncated by token limit"), { truncated: true });
  }
  const text = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  const obj = JSON.parse(text.replace(/```json/gi, "").replace(/```/g, "").trim());
  if (!obj.name || !Array.isArray(obj.ingredients)) throw new Error("bad shape");
  obj.prepMinutes = typeof obj.prepMinutes === "number" ? Math.round(obj.prepMinutes) : null;
  obj.cookMinutes = typeof obj.cookMinutes === "number" ? Math.round(obj.cookMinutes) : null;
  obj.estKcalPerServing = typeof obj.estKcalPerServing === "number" && obj.estKcalPerServing > 0 ? Math.round(obj.estKcalPerServing) : null;
  obj.difficulty = typeof obj.difficulty === "number"
    ? Math.min(5, Math.max(0, Math.round(obj.difficulty)))
    : null;
  obj.steps = Array.isArray(obj.steps) ? obj.steps.map(String).filter(Boolean) : [];
  obj.ingredients = obj.ingredients.map((i: any) => {
    const name = String(i.name || "").trim();
    const category = CATEGORIES.includes(i.category) ? i.category : "Other";
    const recipeAmount = (i.recipeAmount && typeof i.recipeAmount === "object")
      ? { qty: Number(i.recipeAmount.qty) || 0, unit: String(i.recipeAmount.unit || "").trim() }
      : { qty: Number(i.qty) || 0, unit: String(i.unit || "").trim() };
    let purchaseSize: string;
    let purchaseQty: number;
    if (i.purchaseSize && i.purchaseQty != null) {
      purchaseSize = String(i.purchaseSize).trim();
      purchaseQty = Math.max(1, Math.ceil(Number(i.purchaseQty) || 0));
    } else {
      purchaseSize = recipeAmount.unit
        ? `${recipeAmount.qty} ${recipeAmount.unit}`.trim()
        : String(recipeAmount.qty);
      purchaseQty = 1;
    }
    const source: "buy" | "reused" | "staple" =
      i.source === "reused" ? "reused" : i.source === "staple" ? "staple" : "buy";
    const preparedEarlier: boolean = i.preparedEarlier === true;
    return { name, recipeAmount, purchaseSize, purchaseQty, category, source, preparedEarlier };
  }).filter((i: any) => i.name);
  obj.provenance = typeof obj.provenance === "string" ? obj.provenance : "";
  obj.reuseNotes = Array.isArray(obj.reuseNotes) ? obj.reuseNotes.filter((s: any) => typeof s === "string") : [];
  obj.pantryNote = typeof obj.pantryNote === "string" ? obj.pantryNote : "";
  return obj;
}

function buildSeedPrompt(target: string, servings = 4): string {
  return `You are creating ONE original dinner recipe for a family that shops at ALDI. Dish to create: ${target}. Use mainstream, affordable ALDI ingredients; include EVERY ingredient (mains, reused, staples) each with a "source". Write an ORIGINAL recipe — original steps and wording in your own words; do NOT reproduce any specific published recipe. Set "name" to a specific, distinctive dish name.

` + recipeOutputContract(servings);
}

/* ====================================================================== */
export default function App() {
  // TER-325: capture referral code from /<CODE> path before auth loads
  useEffect(() => {
    const m = window.location.pathname.match(/^\/([A-Za-z0-9]{12})$/);
    if (m) {
      try { localStorage.setItem("referredBy", m[1].toUpperCase()); } catch {}
      window.history.replaceState({}, "", "/");
    }
  }, []);

  /* ---- Supabase auth ---- */
  const [session, setSession] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [qualificationNumber, setQualificationNumber] = useState<number | null>(null);
  const [approvedStatus, setApprovedStatus] = useState<boolean | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const prevUserId = useRef<string | null>(null);
  const hydrated = useRef(false); // true once this user's Supabase row has been fetched

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoaded(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line

  // TER-236: resolve admin flag from server (server reads ADMIN_EMAILS, never bundled to client).
  useEffect(() => {
    if (!session?.access_token) { setIsAdmin(false); return; }
    let cancelled = false;
    fetch("/api/me", { headers: { authorization: `Bearer ${session.access_token}` } })
      .then((r) => (r.ok ? r.json() : { isAdmin: false }))
      .then((d) => { if (!cancelled) { setIsAdmin(!!d.isAdmin); setQualificationNumber(d.qualification_number ?? null); } })
      .catch(() => { if (!cancelled) setIsAdmin(false); });
    return () => { cancelled = true; };
  }, [session?.access_token]);

  const handleSignOut = () => supabase.auth.signOut();

  // TER-238: check profiles.approved; recheck on window focus so approval propagates.
  useEffect(() => {
    if (!session?.user?.id) { setApprovedStatus(null); return; }
    let cancelled = false;
    const checkApproval = () => {
      supabase
        .from("profiles")
        .select("approved")
        .eq("id", session.user.id)
        .maybeSingle()
        .then(({ data, error }) => {
          if (cancelled) return;
          setApprovedStatus(error || !data ? false : !!data.approved);
        });
    };
    checkApproval();
    window.addEventListener("focus", checkApproval);
    return () => { cancelled = true; window.removeEventListener("focus", checkApproval); };
  }, [session?.user?.id]); // eslint-disable-line

  const [loaded, setLoaded] = useState(false);
  const VALID_TABS = ["today", "setup", "plan", "list", "rotation", "receipt", "history", "catalog"];
  const [tab, setTab] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("alldeezmeals-active-tab");
      if (saved && VALID_TABS.includes(saved)) return saved;
    } catch {}
    return "today";
  });
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [printSource, setPrintSource] = useState<"current" | string>("current");
  const [historyPrintMeals, setHistoryPrintMeals] = useState<Array<{ date: string; meal: { data: any } }> | null>(null);
  // TER-236: safety reset — if admin flips off while Catalog is open, redirect to setup.
  useEffect(() => { if (!isAdmin && tab === "catalog") setTab("setup"); }, [isAdmin, tab]);
  // TER-348: persist active tab so refresh restores user's place.
  useEffect(() => { try { localStorage.setItem("alldeezmeals-active-tab", tab); } catch {} }, [tab]);
  // TER-288: after history print DOM renders, fire window.print() then reset to current plan
  useEffect(() => {
    if (printSource !== "current" && historyPrintMeals !== null) {
      window.print();
      setPrintSource("current");
      setHistoryPrintMeals(null);
    }
  }, [printSource, historyPrintMeals]); // eslint-disable-line

  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [startDate, setStartDate] = useState(isoToday());
  const [numDays, setNumDays] = useState(7);
  const [days, setDays] = useState([1, 2, 3, 4, 5, 6, 7].map(() => makeDay()));
  const [forecast, setForecast] = useState<Record<string, any>>({});
  const [fxStatus, setFxStatus] = useState("idle");

  const [meals, setMeals] = useState<Record<string, any>>({});
  const [staples, setStaples] = useState(DEFAULT_STAPLES);
  const [pantry, setPantry] = useState<string[]>([]);
  const [alwaysHave, setAlwaysHave] = useState<string[]>([]);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [weekAdditions, setWeekAdditions] = useState<Array<{id: string; name: string; qty: string}>>([]);
  const [defaultPeople, setDefaultPeople] = useState(4);
  const [efficiency, setEfficiency] = useState(true);
  const [mixCuisines, setMixCuisines] = useState(true);
  const [busy, setBusy] = useState(false);

  const [rotation, setRotation] = useState<any[]>([]);
  const [liked, setLiked] = useState<string[]>([]);
  const [avoid, setAvoid] = useState<string[]>([]);
  const [recipeStars, setRecipeStars] = useState<Record<string, number>>({});
  const [currentWeek, setCurrentWeek] = useState<any>(null);
  const [cookProgress, setCookProgress] = useState<Record<string, { gathered: number[]; done: number[]; servings: number; made: boolean }>>({});

  /* ---- pinned-recipe materialization ---- */
  const pinnedSignature = useMemo(
    () => days.map((d) => `${d.id}:${d.pinnedRecipe?.name ?? ""}:${d.people}:${!!d.skip}`).join("|"),
    [days]
  );

  useEffect(() => {
    setMeals((prev) => {
      let next = { ...prev };
      let changed = false;
      for (const day of days) {
        if (day.skip) {
          // Skip overrides everything — clear any meal for this day
          if (next[day.id] != null) {
            const { [day.id]: _removed, ...rest } = next;
            next = rest;
            changed = true;
          }
        } else if (day.pinnedRecipe) {
          const scaled = scaleRecipeToHeadcount(day.pinnedRecipe, day.people);
          next = { ...next, [day.id]: { status: "accepted", data: scaled, error: null, kcalInfo: null, pinned: true } };
          changed = true;
        } else if (prev[day.id]?.pinned) {
          const { [day.id]: _removed, ...rest } = next;
          next = rest;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [pinnedSignature]); // eslint-disable-line

  /* ---- persistence ---- */

  // 1. Load from localStorage immediately for fast offline-first boot.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        setLocation(d.location ?? DEFAULT_LOCATION);
        setNumDays(d.numDays ?? 7);
        setDays(d.days ?? days);
        setForecast(d.forecast ?? {});
        setMeals(d.meals ?? {});
        setStaples(d.staples ?? DEFAULT_STAPLES);
        setPantry(d.pantry ?? []);
        setAlwaysHave(d.alwaysHave ?? []);
        setCheckedItems(d.checkedItems ?? {});
        if (d.weekAdditions) setWeekAdditions(d.weekAdditions);
        setDefaultPeople(d.defaultPeople ?? 4);
        setEfficiency(d.efficiency ?? true);
        setMixCuisines(d.mixCuisines ?? true);
        setRotation(d.rotation ?? []);
        setLiked(d.liked ?? []);
        setAvoid(d.avoid ?? []);
        if (d.recipeStars) setRecipeStars(d.recipeStars);
        setCurrentWeek(d.currentWeek ?? null);
        if (d.cookProgress) setCookProgress(d.cookProgress);
      }
    } catch {}
    setLoaded(true);
  }, []); // eslint-disable-line

  // 2. When a user signs in, pull their state from Supabase.
  //    Resets on sign-out so a re-login (same or different user) always re-fetches.
  //    Falls back to whatever localStorage loaded if no Supabase row exists yet.
  //    Sets hydrated=true in both branches so effect 3 never writes before the fetch resolves.
  useEffect(() => {
    const userId = session?.user?.id ?? null;
    if (!userId) { prevUserId.current = null; hydrated.current = false; return; }
    if (userId === prevUserId.current) return;
    prevUserId.current = userId;
    hydrated.current = false;
    supabase
      .from("user_state")
      .select("state")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) { console.warn("user_state fetch failed:", error.message); hydrated.current = true; return; }
        if (data?.state) {
          const d = data.state;
          if (d.location !== undefined) setLocation(d.location);
          if (d.numDays !== undefined) setNumDays(d.numDays);
          if (d.days !== undefined) setDays(d.days);
          if (d.forecast !== undefined) setForecast(d.forecast);
          if (d.meals !== undefined) setMeals(d.meals);
          if (d.staples !== undefined) setStaples(d.staples);
          if (d.pantry !== undefined) setPantry(d.pantry);
          if (d.alwaysHave !== undefined) setAlwaysHave(d.alwaysHave);
          if (d.checkedItems !== undefined) setCheckedItems(d.checkedItems);
          if (d.weekAdditions !== undefined) setWeekAdditions(d.weekAdditions);
          if (d.defaultPeople !== undefined) setDefaultPeople(d.defaultPeople);
          if (d.efficiency !== undefined) setEfficiency(d.efficiency);
          if (d.mixCuisines !== undefined) setMixCuisines(d.mixCuisines);
          if (d.rotation !== undefined) setRotation(d.rotation);
          if (d.liked !== undefined) setLiked(d.liked);
          if (d.avoid !== undefined) setAvoid(d.avoid);
          if (d.recipeStars !== undefined) setRecipeStars(d.recipeStars);
          if (d.currentWeek !== undefined) setCurrentWeek(d.currentWeek);
          if (d.cookProgress !== undefined) setCookProgress(d.cookProgress);
        } else if (data === null) {
          // No row — one-time migration: push existing localStorage up to Supabase.
          // Only fires when maybeSingle returns null (no row ever written for this user).
          // If any row exists (even empty, e.g. after Start-over), we skip — cloud wins.
          try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const local = raw ? JSON.parse(raw) : null;
            if (local && typeof local === "object") {
              supabase
                .from("user_state")
                .upsert(
                  { user_id: userId, state: local, updated_at: new Date().toISOString() },
                  { onConflict: "user_id" },
                )
                .then(({ error: migrateErr }) => {
                  if (migrateErr) console.warn("user_state migrate failed:", migrateErr.message);
                  hydrated.current = true;
                });
              return; // hydrated.current set inside the nested callback above
            }
          } catch {}
        }
        hydrated.current = true;
      });
  }, [session]); // eslint-disable-line

  // 3. Save to localStorage immediately and to Supabase (debounced 2 s) on every change.
  //    localStorage acts as offline cache; Supabase is the authoritative cross-device store.
  useEffect(() => {
    if (!loaded) return;
    const payload = {
      location, startDate, numDays, days, forecast, meals, staples, pantry, alwaysHave,
      checkedItems, weekAdditions, defaultPeople, efficiency, mixCuisines, rotation, liked, avoid, recipeStars, currentWeek, cookProgress,
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch {}
    if (!session) return;
    if (!hydrated.current) return; // don't push to Supabase before the row is hydrated
    const t = setTimeout(() => {
      supabase
        .from("user_state")
        .upsert(
          { user_id: session.user.id, state: payload, updated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        )
        .then(({ error }) => { if (error) console.warn("user_state upsert failed:", error.message); });
    }, 2000);
    return () => clearTimeout(t);
  }, [location, startDate, numDays, days, forecast, meals, staples, pantry, alwaysHave, checkedItems, weekAdditions, defaultPeople, efficiency, mixCuisines, rotation, liked, avoid, recipeStars, currentWeek, cookProgress, loaded, session]); // eslint-disable-line

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
  const callClaude = async (prompt: string) => generateRecipeFromPrompt(prompt, session?.access_token ?? "");

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

    const lvl = EFFORT_LEVELS.find((l) => l.key === (day.effort ?? "any"));
    const effortGuide = (lvl && lvl.key !== "any")
      ? `Desired effort: set "difficulty" between ${lvl.min} (${DIFFICULTY_LABELS[lvl.min]}) and ${lvl.max} (${DIFFICULTY_LABELS[lvl.max]}).` +
        (lvl.max <= 1 ? ` Favor a quick, convenient, low-effort dinner.`
         : lvl.min >= 4 ? ` A more ambitious, involved dinner is welcome.` : ``)
      : "";

    const prior = committed.length
      ? committed.map((m) => `- ${m.name}: ${m.ingredients
          .filter((i: any) => !i.source || i.source === "buy")
          .map((i: any) => {
            const buy = i.purchaseSize
              ? `${i.purchaseQty ?? 1}×${i.purchaseSize}`
              : `${i.recipeAmount?.qty ?? i.qty ?? 0}${i.recipeAmount?.unit ?? i.unit ? " " + (i.recipeAmount?.unit ?? i.unit) : ""}`;
            return `${i.name} [buy: ${buy}]`;
          }).join(", ")}`).join("\n")
      : "none yet";

    const eff = efficiency
      ? `Efficiency rules:
- Mainstream, affordable ALDI ingredients. Bias strongly to ALDI-stocked everyday items; avoid exotic spices, specialty oils, or artisan/niche products unless they are the central defining ingredient of the dish — substitute a common ALDI item when possible.
- INCLUDE EVERY ingredient needed to cook this dish in the "ingredients" array — mains, reused items, AND pantry staples. No omissions. The recipe card must be cookable on its own.
- Assign each ingredient a "source" value:
    "buy"    — net-new purchase needed (include purchaseSize + purchaseQty).
    "reused" — from a pack already bought this week for another meal, OR batch-prepped earlier (e.g. shredded chicken from Monday). recipeAmount required; set purchaseSize to "" and purchaseQty to 0.
    "staple" — common pantry item assumed on hand (salt, pepper, dried spices, vegetable/olive oil, etc.). recipeAmount optional (use "to taste" in unit if no qty); omit purchaseSize/purchaseQty.
- Share ingredients across the week; minimize waste.
- The family likes bulk chicken breasts poached with onion+garlic then shredded for multiple dinners. Favor this kind of batch prep — those prepped items are source:"reused".
- If a whole chicken is used, use its parts across more than one dinner.
- Set "reuseNote" to 1–3 short sentences narrating the PROVENANCE of non-buy items: name which specific meals share a pack (source:"reused") and call out pantry staples as a group (source:"staple"). Example: "Corn tortillas: from the 30-ct pack bought this week for the chorizo tacos. Shredded chicken: poached & shredded earlier from the breast pack. Garlic powder, cumin, and chili powder are pantry staples you likely have."
- Set "provenance" to 1–2 sentences for the cook explaining what was batch-prepped from a PRIOR meal and is ready to use now (e.g. "The chicken is already cooked — you made it Saturday."). Empty string when nothing was prepared earlier (no preparedEarlier:true ingredients).
- Set "reuseNotes" to a string array — one entry per reused/prepared item or logical group (e.g. ["Shredded chicken: poached & shredded earlier from the breast pack.", "Corn tortillas: from the 30-ct pack bought for the chorizo tacos."]). This is the same reasoning as reuseNote split per line. Empty array if no reuse.
- Set "pantryNote" to a short comma-separated string listing the pantry staples used (e.g. "Cumin, chili powder, garlic powder, salt"). Empty string if none.`
      : `Use mainstream, affordable ALDI ingredients. Bias to ALDI-stocked everyday items; avoid exotic or specialty items unless they are central to the dish. Include EVERY ingredient in the array with a "source" field: "buy" (net-new purchase), "reused" (from another meal's pack or batch-prep this week), or "staple" (common pantry item assumed on hand). Set reuseNote to briefly explain provenance of non-buy items. Set provenance to 1–2 sentences about what was batch-prepped earlier and is ready to use (empty string if none). Set reuseNotes to a string array — one entry per reused item or group (empty array if none). Set pantryNote to a comma-separated list of pantry staples used (empty string if none).`;

    const loves = Array.from(new Set([...liked, ...rotation.map((r) => r.name)]));
    const prefLines: string[] = [];
    if (loves.length) prefLines.push(`The family LIKED these before (lean toward this style, keep variety): ${loves.slice(0, 12).join(", ")}.`);
    if (avoid.length) prefLines.push(`AVOID these (disliked): ${avoid.slice(0, 12).join(", ")}.`);

    const dietary = detectDietaryTerms(day.note ?? "");

    return `You are a practical weekly dinner planner for a family that shops at ALDI. Generate ONE dinner only (breakfast and lunch are covered by staples).

${wlabel}
People eating: ${day.people}
${tempGuide}
${cuisineGuide}
${effortGuide}
${day.note ? `Extra request: ${day.note}` : ""}
${dietary.length ? `DIETARY CONSTRAINT (best-effort): the diner must avoid ${dietary.join(", ")}. Do not use these ingredients or obvious derivatives. This is a best-effort accommodation, not an allergen guarantee.` : ""}
${prefLines.join("\n")}

${eff}
- Do NOT repeat a main dish already planned this week.
${reject ? `\nThe user REJECTED "${reject}". Propose a clearly DIFFERENT dinner (different main and ideally different cuisine).` : ""}

Dinners already planned this week (with purchased ingredients):
${prior}

${recipeOutputContract(day.people)}`;
  };

  const committedData = (excludeId?: string) => days
    .filter((d) => d.id !== excludeId)
    .map((d) => meals[d.id])
    .filter((m) => m && (m.status === "accepted" || m.status === "ready"))
    .map((m) => m.data);

  const usedCuisinesFrom = (data: any[]) => Array.from(new Set(data.map((m) => m.cuisine).filter(Boolean)));

  const generateOne = async (day: any, idx: number, committed: any[], reject?: string) => {
    setMeals((m) => ({ ...m, [day.id]: { status: "loading", data: null, error: null, kcalInfo: null } }));
    try {
      const dietaryAvoid = detectDietaryTerms(day.note ?? "");
      const tok = session?.access_token ?? "";

      // Attempt library reuse when safe: authenticated, no dietary constraints, not a pinned day.
      if (tok && dietaryAvoid.length === 0 && !day.pinnedRecipe) {
        try {
          const lvl = EFFORT_LEVELS.find((l) => l.key === (day.effort ?? "any"));
          const effortMin = (lvl && lvl.key !== "any") ? lvl.min : null;
          const effortMax = (lvl && lvl.key !== "any") ? lvl.max : null;
          const excludeNames = [
            ...avoid,
            ...rotation.map((r: any) => r.name),
            ...committed.map((m: any) => m.name),
            ...(reject ? [reject] : []),
          ];
          const rr = await fetch("/api/recipes-reuse", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
            body: JSON.stringify({
              people: day.people,
              cuisine: (day.cuisine && day.cuisine !== "Any") ? day.cuisine : null,
              effortMin,
              effortMax,
              excludeNames,
            }),
          });
          if (rr.ok) {
            const rj = await rr.json();
            if (rj.reuse && rj.recipe) {
              const reusedData = rj.recipe;
              setMeals((m) => ({ ...m, [day.id]: { status: "ready", data: reusedData, error: null, kcalInfo: null } }));
              resolveNutrition(reusedData, tok).then((kcalInfo: NutritionResult) => {
                setMeals((m) => {
                  const cur = m[day.id];
                  if (!cur?.data || cur.data.name !== reusedData.name) return m; // stale guard
                  return { ...m, [day.id]: { ...cur, kcalInfo } };
                });
              }).catch(() => {});
              return reusedData;
            }
          }
        } catch {
          // Reuse failure — fall through to generate path.
        }
      }

      let data: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          data = await callClaude(buildPrompt(day, dateFor(idx), committed, usedCuisinesFrom(committed), reject));
          // Gate: server validates and saves. Hard fail → retry; transport/5xx → fail open.
          if (tok) {
            try {
              const vr = await fetch("/api/recipes", {
                method: "POST",
                headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
                body: JSON.stringify(data),
              });
              if (vr.status === 422) throw new Error("bad shape");
              if (!vr.ok) throw new Error(`save error ${vr.status}`);
            } catch (fe: any) {
              if (fe?.message === "bad shape") throw fe;
              console.warn("Recipe save endpoint error — failing open:", fe);
            }
          }
          break;
        } catch (e: any) {
          const retryable = e?.truncated || e instanceof SyntaxError || e?.message === "bad shape";
          if (!retryable) throw e;
          if (attempt === 2) throw new Error("Couldn't generate this recipe — try again.");
        }
      }
      if (dietaryAvoid.length) data.dietaryAvoid = dietaryAvoid;
      setMeals((m) => ({ ...m, [day.id]: { status: "ready", data, error: null, kcalInfo: null } }));
      // Kick off nutrition resolution in background (non-blocking).
      if (tok) {
        resolveNutrition(data, tok).then((kcalInfo: NutritionResult) => {
          setMeals((m) => {
            const cur = m[day.id];
            if (!cur?.data || cur.data.name !== data.name) return m; // stale guard
            return { ...m, [day.id]: { ...cur, kcalInfo } };
          });
        }).catch(() => {});
      }
      return data;
    } catch (e: any) {
      setMeals((m) => ({ ...m, [day.id]: { status: "error", data: null, error: e?.message || "Couldn't generate -- retry.", kcalInfo: null } }));
      return null;
    }
  };

  const generateAll = async () => {
    setBusy(true); setTab("plan");
    const committed = days.map((d) => meals[d.id]).filter((m) => m && m.status === "accepted").map((m) => m.data);
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      if (!!day.skip) continue; // skip overrides pin
      if (day.pinnedRecipe) continue;
      if (meals[day.id]?.status === "accepted") continue;
      const data = await generateOne(day, i, [...committed]);
      if (data) committed.push(data);
    }
    setBusy(false);
  };

  const acceptMeal = (id: string) => setMeals((m) => ({ ...m, [id]: { ...m[id], status: "accepted" } }));
  const rejectMeal = async (day: any, idx: number) => {
    if (day.pinnedRecipe) return;
    await generateOne(day, idx, committedData(day.id), meals[day.id]?.data?.name);
  };

  const resetPlan = () => {
    const pinned: Record<string, any> = {};
    for (const day of days) {
      if (day.pinnedRecipe) {
        pinned[day.id] = { status: "accepted", data: scaleRecipeToHeadcount(day.pinnedRecipe, day.people), error: null, kcalInfo: null, pinned: true };
      }
    }
    setMeals(pinned);
    setCheckedItems({});
    setWeekAdditions([]);
  };

  const handleStartOver = () => {
    if (!window.confirm("Discard this meal plan?\n\nThis permanently deletes the current plan and grocery list. It will NOT be saved to Order history — you won't be able to view or reprint it later.\n\nTo keep it, cancel and use \"Mark ordered & start next week\" instead.\n\n(Your setup, staples, and preferences are kept.)")) return;
    resetPlan();
  };

  const thumbUp = (name: string) => { if (name) setLiked((p) => (p.includes(name) ? p : [...p, name])); };
  const thumbDown = async (day: any, idx: number) => {
    if (day.pinnedRecipe) return;
    const name = meals[day.id]?.data?.name;
    if (name) { setAvoid((p) => (p.includes(name) ? p : [...p, name])); setLiked((p) => p.filter((x) => x !== name)); }
    await rejectMeal(day, idx);
  };
  const addToRotation = (data: any) => { setRotation((p) => (p.some((r) => r.name === data.name) ? p : [...p, data])); thumbUp(data.name); };

  const commitCurrentWeek = () => {
    // Build entries: accepted meals + skipped days, sorted by date
    const acceptedEntries = acceptedMealsForPrint.map(({ day, date, meal }: any) => ({ day, date, meal, skip: false }));
    const skippedEntries = days
      .map((d, i) => ({ day: d, date: addDays(startDate, i), meal: null, skip: true }))
      .filter((e) => !!e.day.skip);
    const allEntries = [...acceptedEntries, ...skippedEntries].sort((a, b) => a.date.localeCompare(b.date));
    setCurrentWeek({
      startDate,
      numDays,
      entries: allEntries,
    });
  };

  /* ---- grocery list ---- */
  const acceptedCount = useMemo(() => days.filter((d) => meals[d.id]?.status === "accepted").length, [days, meals]);

  const groceryList = useMemo(() => {
    const agg: Record<string, any> = {};
    const pushIngredient = (i: any) => {
      const name = String(i.name || "").trim();
      if (!name) return;
      // Only source:"buy" (or absent source for old recipes) goes on the shopping list.
      if (i.source === "reused" || i.source === "staple") return;
      const category = CATEGORIES.includes(i.category) ? i.category : "Other";
      let unit: string, qty: number, isPurchaseStyle: boolean;
      if (i.purchaseSize != null && i.purchaseQty != null) {
        unit = i.purchaseSize;
        qty = Number(i.purchaseQty) || 0;
        isPurchaseStyle = true;
      } else {
        unit = String(i.unit || "").trim();
        qty = Number(i.qty) || 0;
        isPurchaseStyle = false;
      }
      const key = `${normalizeIngName(name)}|${unit.toLowerCase()}`;
      if (!agg[key]) agg[key] = { name, qty: 0, unit, category, staple: false, isPurchaseStyle };
      agg[key].qty += qty;
    };
    days.forEach((d) => { if (!!d.skip) return; const m = meals[d.id]; if (m?.status === "accepted") m.data.ingredients.forEach(pushIngredient); });
    staples.filter((st) => st.enabled).forEach((st) => {
      const k = `${normalizeIngName(st.name)}|${st.unit.toLowerCase()}`;
      if (!agg[k]) agg[k] = { name: st.name, qty: 0, unit: st.unit, category: CATEGORIES.includes(st.category) ? st.category : "Other", staple: false, isPurchaseStyle: false };
      agg[k].qty += Number(st.qty) || 0;
      agg[k].staple = true;
    });
    const byCat: Record<string, any[]> = {}; CATEGORIES.forEach((c) => (byCat[c] = []));
    Object.values(agg).forEach((it: any) => {
      if (it.qty === 0) return;
      if (pantry.includes(it.name.toLowerCase())) return;
      if (alwaysHave.includes(normalizeIngName(it.name))) return;
      (byCat[it.category] || byCat.Other).push(it);
    });
    CATEGORIES.forEach((c) => byCat[c].sort((a, b) => a.name.localeCompare(b.name)));
    return byCat;
  }, [days, meals, staples, pantry, alwaysHave]);

  const totalItems = useMemo(() => Object.values(groceryList).reduce((n, a) => n + a.length, 0), [groceryList]);

  const acceptedMealsForPrint = useMemo(
    () => days
      .map((d, i) => ({ day: d, date: addDays(startDate, i), meal: meals[d.id] }))
      .filter(({ day, meal }) => !day.skip && meal?.status === "accepted"),
    [days, meals, startDate]
  );

  const listText = useMemo(() => {
    const lines: string[] = [];
    CATEGORIES.forEach((cat) => {
      const items = groceryList[cat]; if (!items?.length) return;
      lines.push(`${cat}:`);
      items.forEach((it: any) => { lines.push(`  - ${it.name} (${fmtPurchaseQty(it.qty, it.unit, it.isPurchaseStyle)})`); });
      lines.push("");
    });
    return lines.join("\n").trim();
  }, [groceryList]);

  const handleMarkOrdered = async (): Promise<{ error: string | null }> => {
    const snapshot = {
      startDate,
      numDays,
      location,
      meals: acceptedMealsForPrint.map(({ day, date, meal }: any) => ({
        day: weekdayLabel(date),
        date,
        mealData: meal.data,
      })),
      groceryList,
      listText,
    };
    try {
      const { error } = await supabase
        .from("orders")
        .insert({ user_id: session.user.id, plan: snapshot });
      if (error) {
        console.warn("Failed to archive order:", error);
        return { error: error.message };
      }
      resetPlan();
      setCurrentWeek(null);
      return { error: null };
    } catch (e: any) {
      console.warn("Failed to archive order:", e);
      return { error: e?.message || "Network error — plan not archived." };
    }
  };

  const isMobile = useIsMobile();

  /* ---- auth gate ---- */
  if (!authLoaded) {
    return <div style={{ ...s.shell, padding: isMobile ? 12 : 20 }}><style>{fontImport}</style></div>;
  }

  if (!session) {
    return (
      <div style={{ ...s.shell, padding: isMobile ? 12 : 20 }}>
        <style>{fontImport}</style>
        <header style={s.header}>
          <div style={s.logoRow}>
            <DPlate size={isMobile ? 40 : 46} />
            <div>
              <h1 style={s.h1}><span style={{ color: "var(--c-text)" }}>ALLDEEZ</span><span style={{ color: "var(--c-primary)" }}>Meals</span></h1>
              <p style={s.sub}>A week of dinners, planned in minutes.</p>
            </div>
          </div>
        </header>
        <SignInView />
      </div>
    );
  }

  // TER-238: approval gate — fail closed (null = not yet checked, false = unapproved).
  if (approvedStatus === null) {
    return <div style={{ ...s.shell, padding: isMobile ? 12 : 20 }}><style>{fontImport}</style><p style={{ fontFamily: serif, color: "var(--c-text-muted)" }}>Loading your kitchen...</p></div>;
  }

  if (!approvedStatus) {
    return (
      <div style={{ ...s.shell, padding: isMobile ? 12 : 20 }}>
        <style>{fontImport}</style>
        <PendingView onSignOut={handleSignOut} />
      </div>
    );
  }

  if (!loaded) return <div style={{ ...s.shell, padding: isMobile ? 12 : 20 }}><style>{fontImport}</style><p style={{ fontFamily: serif, color: "var(--c-text-muted)" }}>Loading your kitchen...</p></div>;

  return (
    <>
    <div className="no-print" style={{ ...s.shell, padding: isMobile ? 12 : 20 }}>
      <style>{fontImport}</style>
      <header style={s.header}>
        <div style={{ ...s.logoRow, justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <DPlate size={isMobile ? 40 : 46} />
            <div>
              <h1 style={s.h1}><span style={{ color: "var(--c-text)" }}>ALLDEEZ</span><span style={{ color: "var(--c-primary)" }}>Meals</span></h1>
              <p style={s.sub}>A week of dinners, planned in minutes.</p>
              <span style={s.betaBadge}>Beta · Free during beta</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11.5, color: "var(--c-text-muted)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session?.user?.email}</span>
            <a href="/help.html" style={{ ...s.signOutBtn, textDecoration: "none", display: "inline-flex", alignItems: "center" }} title="Help" aria-label="Help">
              <HelpCircle size={15} />
            </a>
            <button onClick={() => setFeedbackOpen(true)} style={s.signOutBtn} title="Send feedback" aria-label="Send feedback">
              <MessageSquare size={15} />
            </button>
            <button onClick={handleSignOut} style={s.signOutBtn} title="Sign out">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      <nav style={s.tabs}>
        <TabBtn active={tab === "today"} onClick={() => setTab("today")} icon={<CalendarDays size={15} />} label="Today" />
        <div style={{ ...s.planGroup, ...((tab === "setup" || tab === "plan") ? s.planGroupActive : {}) }}>
          <span style={s.planGroupLabel}>Planning</span>
          <div style={{ display: "flex", gap: 5 }}>
            <TabBtn active={tab === "setup"} onClick={() => setTab("setup")} icon={<Settings2 size={15} />} label="Setup" />
            <TabBtn active={tab === "plan"} onClick={() => setTab("plan")} icon={<Sparkles size={15} />} label={`Meals (${acceptedCount}/${days.length})`} />
          </div>
        </div>
        <TabBtn active={tab === "list"} onClick={() => setTab("list")} icon={<ListChecks size={15} />} label={`Shopping List (${totalItems})`} />
        <TabBtn active={tab === "rotation"} onClick={() => setTab("rotation")} icon={<Star size={15} />} label={`Recipe Box (${rotation.length})`} />
        <TabBtn active={tab === "receipt"} onClick={() => setTab("receipt")} icon={<ReceiptText size={15} />} label="Receipt" />
        <TabBtn active={tab === "history"} onClick={() => setTab("history")} icon={<Clock size={15} />} label="History" />
        {isAdmin && <TabBtn active={tab === "catalog"} onClick={() => setTab("catalog")} icon={<Archive size={15} />} label="Catalog" />}
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
            staples={staples} setStaples={setStaples} rotation={rotation}
            onGenerate={generateAll} busy={busy} onStartOver={handleStartOver} isMobile={isMobile}
          />
        )}
        {tab === "plan" && (
          <PlanView
            days={days} meals={meals} busy={busy} dateFor={dateFor} forecast={forecast}
            onAccept={acceptMeal} onReject={rejectMeal}
            onThumbUp={(d: any) => thumbUp(meals[d.id]?.data?.name)} onThumbDown={thumbDown}
            onAddRotation={(d: any) => addToRotation(meals[d.id].data)}
            liked={liked} onGenerate={generateAll}
            onAllAccepted={() => { commitCurrentWeek(); setTab("today"); }} acceptedCount={acceptedCount}
          />
        )}
        {tab === "today" && (
          <TodayCook
            currentWeek={currentWeek}
            forecast={forecast}
            isMobile={isMobile}
            cookProgress={cookProgress}
            setCookProgress={setCookProgress}
            recipeStars={recipeStars}
            setRecipeStars={setRecipeStars}
            liked={liked} setLiked={setLiked}
            avoid={avoid} setAvoid={setAvoid}
            pantry={pantry}
            alwaysHave={alwaysHave}
          />
        )}
        {tab === "list" && (
          <ListView groceryList={groceryList} totalItems={totalItems} listText={listText}
            pantry={pantry} setPantry={setPantry} checkedItems={checkedItems} setCheckedItems={setCheckedItems}
            weekAdditions={weekAdditions} setWeekAdditions={setWeekAdditions}
            acceptedCount={acceptedCount} slotCount={days.length} location={location}
            onMarkOrdered={handleMarkOrdered} alwaysHave={alwaysHave} setAlwaysHave={setAlwaysHave}
            session={session} qualificationNumber={qualificationNumber} setQualificationNumber={setQualificationNumber} />
        )}
        {tab === "rotation" && (
          <RotationView rotation={rotation} setRotation={setRotation} liked={liked} setLiked={setLiked} avoid={avoid} setAvoid={setAvoid} recipeStars={recipeStars} setRecipeStars={setRecipeStars} />
        )}
        {tab === "receipt" && <IngestView session={session} />}
        {tab === "history" && (
          <OrderHistoryView
            session={session}
            onReprint={(meals) => { setHistoryPrintMeals(meals); setPrintSource("history"); }}
          />
        )}
        {tab === "catalog" && isAdmin && <CatalogView session={session} />}
      </main>
      <footer className="no-print" style={{ marginTop: 24, padding: "16px 4px 8px", borderTop: "1px solid var(--c-border)", fontSize: 12, color: "var(--c-text-muted)", textAlign: "center" as const }}>
        <a href="/help.html" style={{ color: "var(--c-text-muted)" }}>Help</a>
        {" · "}
        <a href="/terms.html" style={{ color: "var(--c-text-muted)" }}>Terms</a>
        {" · "}
        <a href="/privacy.html" style={{ color: "var(--c-text-muted)" }}>Privacy</a>
        {" · "}
        <a href="/offer.html" style={{ color: "var(--c-text-muted)" }}>Beta Offer</a>
        <br />
        ALLDEEZMeals is an independent service and is not affiliated with, endorsed by, or sponsored by ALDI. ALDI is a trademark of its respective owner.
      </footer>
    </div>
    {printSource === "current" && acceptedMealsForPrint.length > 0 && (
    <div className="print-only" style={{ background: isMobile ? "var(--c-bg)" : "var(--c-print-mat)", padding: isMobile ? "var(--space-5)" : "var(--space-7)", overflowX: "hidden" }}>
      {acceptedMealsForPrint.map(({ day, date, meal }, pi) => (
        <div key={pi} className="recipe-page" style={{ marginBottom: pi < acceptedMealsForPrint.length - 1 ? "var(--space-7)" : 0 }}>
          <div className="print-sheet" style={{ background: "#fff", maxWidth: 640, margin: "0 auto", padding: isMobile ? "var(--space-6)" : "56px 64px", boxShadow: isMobile ? "none" : "0 8px 30px rgba(26,58,52,.18)", border: isMobile ? "1px solid var(--c-border)" : "none", borderRadius: isMobile ? "var(--radius-md)" : 4, color: "#1A3A34", boxSizing: "border-box" as const }}>
            {/* masthead */}
            <div style={{ display: "flex", flexWrap: "wrap" as const, justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-2)", borderBottom: "2px solid #1A3A34", paddingBottom: "var(--space-2)" }}>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-label-size)", fontWeight: 700, letterSpacing: "var(--t-label-tracking)", textTransform: "uppercase" as const, color: "var(--c-primary)" }}>ALLDEEZMeals</span>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", fontWeight: 600, color: "var(--c-text-muted)" }}>{weekdayLabel(date)} · {meal.data.cuisine}</span>
            </div>
            {/* title */}
            <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 26, lineHeight: "30px", fontWeight: 600, letterSpacing: "-.01em", margin: "var(--space-4) 0 0", color: "#1A3A34" }}>{meal.data.name}</h1>
            {/* meta strip */}
            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: "var(--space-5)", marginTop: "var(--space-3)", paddingBottom: "var(--space-4)", borderBottom: "1px solid var(--c-border)" }}>
              {([
                ["Prep", meal.data.prepMinutes != null ? `${meal.data.prepMinutes} min` : "—"],
                ["Cook", meal.data.cookMinutes != null ? `${meal.data.cookMinutes} min` : "—"],
                ["Serves", String(meal.data.servings ?? "—")],
                ["Per serving", meal.kcalInfo?.kcalPerServing != null ? `~${meal.kcalInfo.kcalPerServing} kcal` : "—"],
                ["Effort", meal.data.difficulty != null ? `${(["Premade","Minimal","Simple","Moderate","Involved","Intricate"] as const)[meal.data.difficulty]} (${meal.data.difficulty}/5)` : "—"],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", fontWeight: 600, color: "var(--c-text-muted)", textTransform: "uppercase" as const, letterSpacing: ".05em" }}>{k}</div>
                  <div style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-body-size)", lineHeight: "var(--t-body-lh)", fontWeight: 700, color: "#1A3A34" }}>{v}</div>
                </div>
              ))}
            </div>
            {meal.data.dietaryAvoid?.length > 0 && (
              <div style={{ border: "1px solid #1A3A34", borderRadius: 4, padding: "8px 12px", marginTop: "var(--space-4)", fontFamily: "var(--font-sans)", fontSize: "var(--t-body-size)", lineHeight: "var(--t-body-lh)", color: "#1A3A34" }}>
                {dietaryDisclaimer(meal.data.dietaryAvoid)}
              </div>
            )}
            {/* body: ingredients + instructions */}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1.4fr", gap: isMobile ? "var(--space-5)" : "var(--space-7)", marginTop: "var(--space-5)" }}>
              <div>
                <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "var(--t-h3-size)", lineHeight: "var(--t-h3-lh)", fontWeight: 600, margin: "0 0 var(--space-3)", color: "#1A3A34" }}>Ingredients</h2>
                <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                  {meal.data.ingredients.map((ing: any, ii: number) => {
                    const rStr = fmtRecipeQty(ing);
                    return (
                      <li key={ii} style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-body-size)", lineHeight: "var(--t-body-lh)", color: "#1A3A34" }}>
                        {ing.name}{rStr ? <span style={{ color: "var(--c-text-muted)" }}>{" — "}{rStr}</span> : ""}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div>
                <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "var(--t-h3-size)", lineHeight: "var(--t-h3-lh)", fontWeight: 600, margin: "0 0 var(--space-3)", color: "#1A3A34" }}>Instructions</h2>
                {meal.data.steps?.length > 0 && (
                  <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: "var(--space-2)" }}>
                    {meal.data.steps.map((step: string, si: number) => (
                      <li key={si} style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-body-size)", lineHeight: "var(--t-body-lh)", paddingLeft: 4, color: "#1A3A34" }}>{step}</li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
            {/* footer */}
            <div style={{ marginTop: "var(--space-7)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--c-border)", display: "flex", justifyContent: "space-between", flexWrap: "wrap" as const, gap: "var(--space-2)" }}>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", fontWeight: 600, color: "var(--c-text-muted)" }}>Printed from ALLDEEZMeals · {new Date().toLocaleDateString()}</span>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", fontWeight: 600, color: "var(--c-text-muted)" }}>kcal source: USDA FoodData Central</span>
            </div>
          </div>
        </div>
      ))}
    </div>
    )}
    {printSource !== "current" && historyPrintMeals !== null && (
    <div className="print-only" style={{ background: isMobile ? "var(--c-bg)" : "var(--c-print-mat)", padding: isMobile ? "var(--space-5)" : "var(--space-7)", overflowX: "hidden" }}>
      {historyPrintMeals.map(({ date, meal }, pi) => (
        <div key={pi} className="recipe-page" style={{ marginBottom: pi < historyPrintMeals.length - 1 ? "var(--space-7)" : 0 }}>
          <div className="print-sheet" style={{ background: "#fff", maxWidth: 640, margin: "0 auto", padding: isMobile ? "var(--space-6)" : "56px 64px", boxShadow: isMobile ? "none" : "0 8px 30px rgba(26,58,52,.18)", border: isMobile ? "1px solid var(--c-border)" : "none", borderRadius: isMobile ? "var(--radius-md)" : 4, color: "#1A3A34", boxSizing: "border-box" as const }}>
            <div style={{ display: "flex", flexWrap: "wrap" as const, justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-2)", borderBottom: "2px solid #1A3A34", paddingBottom: "var(--space-2)" }}>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-label-size)", fontWeight: 700, letterSpacing: "var(--t-label-tracking)", textTransform: "uppercase" as const, color: "var(--c-primary)" }}>ALLDEEZMeals</span>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", fontWeight: 600, color: "var(--c-text-muted)" }}>{weekdayLabel(date)} · {meal.data.cuisine}</span>
            </div>
            <h1 style={{ fontFamily: "var(--font-serif)", fontSize: 26, lineHeight: "30px", fontWeight: 600, letterSpacing: "-.01em", margin: "var(--space-4) 0 0", color: "#1A3A34" }}>{meal.data.name}</h1>
            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: "var(--space-5)", marginTop: "var(--space-3)", paddingBottom: "var(--space-4)", borderBottom: "1px solid var(--c-border)" }}>
              {([
                ["Prep", meal.data.prepMinutes != null ? `${meal.data.prepMinutes} min` : "—"],
                ["Cook", meal.data.cookMinutes != null ? `${meal.data.cookMinutes} min` : "—"],
                ["Serves", String(meal.data.servings ?? "—")],
                ["Per serving", "—"],
                ["Effort", meal.data.difficulty != null ? `${(["Premade","Minimal","Simple","Moderate","Involved","Intricate"] as const)[meal.data.difficulty]} (${meal.data.difficulty}/5)` : "—"],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", fontWeight: 600, color: "var(--c-text-muted)", textTransform: "uppercase" as const, letterSpacing: ".05em" }}>{k}</div>
                  <div style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-body-size)", lineHeight: "var(--t-body-lh)", fontWeight: 700, color: "#1A3A34" }}>{v}</div>
                </div>
              ))}
            </div>
            {meal.data.dietaryAvoid?.length > 0 && (
              <div style={{ border: "1px solid #1A3A34", borderRadius: 4, padding: "8px 12px", marginTop: "var(--space-4)", fontFamily: "var(--font-sans)", fontSize: "var(--t-body-size)", lineHeight: "var(--t-body-lh)", color: "#1A3A34" }}>
                {dietaryDisclaimer(meal.data.dietaryAvoid)}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1.4fr", gap: isMobile ? "var(--space-5)" : "var(--space-7)", marginTop: "var(--space-5)" }}>
              <div>
                <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "var(--t-h3-size)", lineHeight: "var(--t-h3-lh)", fontWeight: 600, margin: "0 0 var(--space-3)", color: "#1A3A34" }}>Ingredients</h2>
                <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                  {(meal.data.ingredients ?? []).map((ing: any, ii: number) => {
                    const rStr = fmtRecipeQty(ing);
                    return (
                      <li key={ii} style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-body-size)", lineHeight: "var(--t-body-lh)", color: "#1A3A34" }}>
                        {ing.name}{rStr ? <span style={{ color: "var(--c-text-muted)" }}>{" — "}{rStr}</span> : ""}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div>
                <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "var(--t-h3-size)", lineHeight: "var(--t-h3-lh)", fontWeight: 600, margin: "0 0 var(--space-3)", color: "#1A3A34" }}>Instructions</h2>
                {(meal.data.steps ?? []).length > 0 && (
                  <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: "var(--space-2)" }}>
                    {meal.data.steps.map((step: string, si: number) => (
                      <li key={si} style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-body-size)", lineHeight: "var(--t-body-lh)", paddingLeft: 4, color: "#1A3A34" }}>{step}</li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
            <div style={{ marginTop: "var(--space-7)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--c-border)", display: "flex", justifyContent: "space-between", flexWrap: "wrap" as const, gap: "var(--space-2)" }}>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", fontWeight: 600, color: "var(--c-text-muted)" }}>Printed from ALLDEEZMeals · {new Date().toLocaleDateString()}</span>
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", fontWeight: 600, color: "var(--c-text-muted)" }}>kcal source: USDA FoodData Central</span>
            </div>
          </div>
        </div>
      ))}
    </div>
    )}
    {feedbackOpen && <FeedbackModal session={session} tab={tab} onClose={() => setFeedbackOpen(false)} />}
    </>
  );
}

/* ============================ Feedback modal (TER-294) ============================ */
function FeedbackModal({ session, tab, onClose }: { session: any; tab: string; onClose: () => void }) {
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canSubmit = message.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const { error: err } = await supabase.from("feedback").insert({
      message: message.trim(),
      category: category || null,
      email: session?.user?.email ?? null,
      app_context: tab,
    });
    setSubmitting(false);
    if (err) {
      setError(err.message);
    } else {
      setDone(true);
      setTimeout(onClose, 1800);
    }
  };

  const sans = "'Plus Jakarta Sans', -apple-system, sans-serif";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(0,0,0,.45)" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--c-surface)", borderRadius: 14, padding: 20, width: "100%", maxWidth: 400, boxShadow: "0 8px 32px rgba(0,0,0,.25)", display: "flex", flexDirection: "column", gap: 14 }}>
        {done ? (
          <div style={{ textAlign: "center" as const, padding: "16px 0" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
            <p style={{ fontFamily: sans, fontWeight: 700, fontSize: 15, color: "var(--c-primary)", margin: 0 }}>Thanks — got it!</p>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontSize: 17, fontWeight: 600, margin: 0, color: "var(--c-text)" }}>Send feedback</h2>
              <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--c-text-muted)", padding: 4, display: "grid", placeItems: "center" }} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={{ padding: "9px 10px", border: "1px solid var(--c-border)", borderRadius: 8, fontFamily: sans, fontSize: 13, color: "var(--c-text)", background: "var(--c-surface)" }}
            >
              <option value="">Category (optional)</option>
              <option value="Bug">Bug</option>
              <option value="Idea">Idea</option>
              <option value="Other">Other</option>
            </select>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us what you think, or describe a bug…"
              rows={4}
              style={{ padding: "9px 10px", border: "1px solid var(--c-border)", borderRadius: 8, fontFamily: sans, fontSize: 13, color: "var(--c-text)", background: "var(--c-surface)", resize: "vertical", lineHeight: 1.5 }}
            />
            {error && (
              <p style={{ color: "var(--c-danger)", fontSize: 12.5, margin: 0, display: "flex", alignItems: "center", gap: 5 }}>
                <AlertCircle size={13} /> {error}
              </p>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="btn-primary"
                style={{ flex: 1, opacity: canSubmit ? 1 : 0.5 }}
              >
                {submitting ? <><RefreshCw size={15} className="spin" /> Sending…</> : "Submit"}
              </button>
              <button onClick={onClose} className="btn-ghost" style={{ flex: "0 0 auto" }}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ============================ Sign-in / Sign-up ============================ */
function SignInView() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nearestAldi, setNearestAldi] = useState("");
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSignIn = async () => {
    const addr = email.trim();
    if (!addr) return;
    setLoading(true);
    setError("");
    const { error: err } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { shouldCreateUser: false },
    });
    setLoading(false);
    if (err) { setError(err.message); } else { setSent(true); }
  };

  const handleSignUp = async () => {
    const addr = email.trim();
    if (!addr || !firstName.trim() || !lastName.trim()) return;
    setLoading(true);
    setError("");
    const referredBy = localStorage.getItem("referredBy");
    const { error: err } = await supabase.auth.signInWithOtp({
      email: addr,
      options: {
        shouldCreateUser: true,
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          name: `${firstName.trim()} ${lastName.trim()}`.trim(),
          nearest_aldi: nearestAldi.trim(),
          reason: reason.trim(),
          ...(referredBy ? { referred_by: referredBy } : {}),
        },
      },
    });
    setLoading(false);
    if (err) { setError(err.message); } else {
      try { localStorage.removeItem("referredBy"); } catch {}
      setSent(true);
    }
  };

  const switchMode = (m: "signin" | "signup") => { setMode(m); setError(""); setSent(false); };

  const consentLine = (
    <p style={{ fontSize: 11.5, color: "var(--c-text-muted)", margin: "12px 0 0", textAlign: "center" as const, lineHeight: 1.5 }}>
      By continuing you agree to our{" "}
      <a href="/terms.html" style={{ color: "var(--c-primary)" }}>Terms</a>
      {" · "}
      <a href="/privacy.html" style={{ color: "var(--c-primary)" }}>Privacy Policy</a>.
    </p>
  );

  if (sent) {
    return (
      <div style={{ ...s.card, maxWidth: 360, margin: "48px auto", textAlign: "center" as const }}>
        <h2 style={{ fontFamily: serif, fontSize: 18, fontWeight: 600, margin: "0 0 8px", color: "var(--c-text)" }}>Check your email</h2>
        <p style={{ fontSize: 13.5, color: "var(--c-text-muted)", margin: 0, lineHeight: 1.55 }}>
          {mode === "signup"
            ? <>A sign-in link was sent to <strong>{email.trim()}</strong>. Click it to continue — your account will be pending admin approval once you sign in.</>
            : <>A sign-in link was sent to <strong>{email.trim()}</strong>. Click it to continue.</>}
        </p>
      </div>
    );
  }

  if (mode === "signup") {
    const canSubmit = email.trim() && firstName.trim() && lastName.trim() && !loading;
    return (
      <div style={{ ...s.card, maxWidth: 360, margin: "48px auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <h2 style={{ fontFamily: serif, fontSize: 18, fontWeight: 600, margin: 0, color: "var(--c-text)" }}>Request access</h2>
          <button onClick={() => switchMode("signin")} style={{ background: "none", border: "none", fontSize: 12.5, color: "var(--c-primary)", cursor: "pointer", padding: 0 }}>
            Sign in instead
          </button>
        </div>
        <p style={s.cardSub}>Fill in a few details — an admin approves before you get full access.</p>
        <p style={{ fontSize: 12, color: "var(--c-primary)", margin: "4px 0 0" }}>
          <a href="/offer.html" style={{ color: "var(--c-primary)" }}>First 50 beta testers → 1 year free</a>
        </p>
        {error && (
          <p style={{ color: "var(--c-danger)", fontSize: 13, margin: "10px 0 0", display: "flex", alignItems: "center", gap: 5 }}>
            <AlertCircle size={14} /> {error}
          </p>
        )}
        <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
          <div>
            <label style={s.fieldLabel}>First name *</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              style={{ ...s.input, width: "100%", boxSizing: "border-box" } as any}
              placeholder="First name"
              autoFocus
            />
          </div>
          <div>
            <label style={s.fieldLabel}>Last name *</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              style={{ ...s.input, width: "100%", boxSizing: "border-box" } as any}
              placeholder="Last name"
            />
          </div>
          <div>
            <label style={s.fieldLabel}>Email *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ ...s.input, width: "100%", boxSizing: "border-box" } as any}
              placeholder="your@email.com"
            />
          </div>
          <div>
            <label style={s.fieldLabel}>Nearest ALDI store</label>
            <input
              type="text"
              value={nearestAldi}
              onChange={(e) => setNearestAldi(e.target.value)}
              style={{ ...s.input, width: "100%", boxSizing: "border-box" } as any}
              placeholder="e.g. ALDI Bloomfield, IA"
            />
          </div>
          <div>
            <label style={s.fieldLabel}>Why do you want to test?</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canSubmit && handleSignUp()}
              style={{ ...s.input, width: "100%", boxSizing: "border-box" } as any}
              placeholder="Tell us a little about yourself"
            />
          </div>
        </div>
        <button
          onClick={handleSignUp}
          disabled={!canSubmit}
          style={{ ...s.primaryBtn, width: "100%", justifyContent: "center", marginTop: 14, opacity: canSubmit ? 1 : 0.5 }}
        >
          {loading ? <><RefreshCw size={16} className="spin" /> Sending…</> : "Request access"}
        </button>
        {consentLine}
      </div>
    );
  }

  return (
    <div style={{ ...s.card, maxWidth: 360, margin: "48px auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <h2 style={{ fontFamily: serif, fontSize: 18, fontWeight: 600, margin: 0, color: "var(--c-text)" }}>Sign in</h2>
        <button onClick={() => switchMode("signup")} style={{ background: "none", border: "none", fontSize: 12.5, color: "var(--c-primary)", cursor: "pointer", padding: 0 }}>
          New? Request access
        </button>
      </div>
      <p style={s.cardSub}>Magic link sent to your email</p>
      {error && (
        <p style={{ color: "var(--c-danger)", fontSize: 13, margin: "10px 0 0", display: "flex", alignItems: "center", gap: 5 }}>
          <AlertCircle size={14} /> {error}
        </p>
      )}
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSignIn()}
        style={{ ...s.input, width: "100%", marginTop: 14, boxSizing: "border-box" } as any}
        placeholder="your@email.com"
        autoFocus
      />
      <button
        onClick={handleSignIn}
        disabled={!email.trim() || loading}
        style={{ ...s.primaryBtn, width: "100%", justifyContent: "center", marginTop: 10, opacity: email.trim() && !loading ? 1 : 0.5 }}
      >
        {loading ? <><RefreshCw size={16} className="spin" /> Sending…</> : "Send magic link"}
      </button>
      {consentLine}
    </div>
  );
}

/* ============================ Pending approval ============================ */
function PendingView({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div style={{ ...s.card, maxWidth: 400, margin: "64px auto", textAlign: "center" as const }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
      <h2 style={{ fontFamily: serif, fontSize: 20, fontWeight: 600, margin: "0 0 10px", color: "var(--c-text)" }}>
        You're in the queue
      </h2>
      <p style={{ fontSize: 14, color: "var(--c-text-muted)", margin: "0 0 20px", lineHeight: 1.6 }}>
        Your account is pending admin approval. You'll get full access as soon as an admin reviews your request — just leave this tab open and it'll update automatically.
      </p>
      <button onClick={onSignOut} style={{ ...s.ghostBtn, margin: "0 auto" }}>
        <LogOut size={15} /> Sign out
      </button>
    </div>
  );
}

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
function SetupView(p: any) {
  const { location, geocode, startDate, setStartDate, numDays, setNumDays, days, updDay, dateFor, forecast, fxStatus,
    defaultPeople, setDefaultPeople, efficiency, setEfficiency, mixCuisines, setMixCuisines, staples, setStaples,
    rotation, onGenerate, busy, onStartOver, isMobile } = p;
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
            <PeopleInput value={defaultPeople} onChange={setDefaultPeople} style={{ ...s.input, width: "100%" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
          <MapPin size={14} color="var(--c-text-muted)" />
          <span style={{ fontSize: 13, color: "var(--c-text-muted)" }}>{location.name}</span>
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
                <div style={{ opacity: day.skip ? 0.4 : 1, pointerEvents: day.skip ? "none" : undefined }}>
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
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
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
                  <input value={day.note} onChange={(e) => updDay(day.id, { note: e.target.value })} placeholder="optional note" style={{ ...s.input, fontSize: 12.5, marginTop: 6, width: "100%" }} />
                </div>
                <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={!!day.skip}
                    onChange={(e) => updDay(day.id, { skip: e.target.checked })}
                    style={{ width: 15, height: 15, flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 13, color: day.skip ? "var(--c-danger)" : "var(--c-text-muted)" }}>
                    Skip this day — no dinner
                  </span>
                </label>
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
                <button onClick={() => setStaples((q: any[]) => q.filter((x) => x.id !== st.id))} style={s.iconBtn}><X size={14} color="var(--c-danger)" /></button>
              </div>
            ))}
            <button onClick={() => setStaples((q: any[]) => [...q, { id: uid(), name: "", qty: 1, unit: "", category: "Pantry", enabled: true }])} style={{ ...s.addBtn, marginTop: 4 }}><Plus size={15} /> Add staple</button>
          </div>
        )}
      </div>

      <button onClick={onGenerate} disabled={busy} className="btn-primary btn--block" style={{ opacity: busy ? 0.6 : 1 }}>
        {busy ? <><RefreshCw size={17} className="spin" /> Generating...</> : <><Sparkles size={17} /> Generate meal plan</>}
      </button>
      <button onClick={onStartOver} disabled={busy} className="btn-ghost btn--block btn--sm" style={{ opacity: busy ? 0.5 : 1 }}>
        Start over
      </button>
    </div>
  );
}

/* ============================ Plan — TOC wizard (TER-283) ============================ */
function TocStatusPill({ m, isPinned, isSkipped }: { m: any; isPinned: boolean; isSkipped?: boolean }) {
  const base: any = { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap", flexShrink: 0 };
  if (isSkipped) return <span style={{ ...base, background: "var(--c-surface-2)", color: "var(--c-text-muted)", fontStyle: "italic" }}>Skipped</span>;
  if (isPinned) return <span style={{ ...base, background: "var(--c-primary)", color: "var(--c-on-primary)" }}>📌 Pinned</span>;
  if (!m) return <span style={{ ...base, background: "var(--c-surface-2)", color: "var(--c-text-muted)" }}>Pending</span>;
  if (m.status === "loading") return <span style={{ ...base, background: "var(--c-warning-bg)", color: "var(--c-warning)" }}>Generating…</span>;
  if (m.status === "error") return <span style={{ ...base, background: "var(--c-danger-bg)", color: "var(--c-danger)" }}>Error</span>;
  if (m.status === "accepted") return <span style={{ ...base, background: "var(--c-primary)", color: "var(--c-on-primary)" }}><Check size={11} /> Accepted</span>;
  return <span style={{ ...base, background: "var(--c-accent)", color: "var(--c-pill-text)" }}>Review</span>;
}

function PlanView({ days, meals, busy, dateFor, forecast, onAccept, onReject, onThumbUp, onThumbDown, onAddRotation, liked, onGenerate, onAllAccepted, acceptedCount }: any) {
  const firstMealIdx = days.findIndex((d: any) => meals[d.id]);
  const [activeMealIdx, setActiveMealIdx] = useState<number>(firstMealIdx >= 0 ? firstMealIdx : 0);

  if (!days.some((d: any) => meals[d.id])) {
    return (
      <div style={s.card}>
        <p style={s.empty}>No meals yet.</p>
        <button onClick={onGenerate} disabled={busy} className="btn-primary" style={{ marginTop: 12 }}>
          <Sparkles size={16} /> Generate meal plan
        </button>
      </div>
    );
  }

  const total = days.length;
  const safeIdx = Math.min(activeMealIdx, total - 1);
  const activeDay = days[safeIdx];
  const m = meals[activeDay?.id];
  const date = dateFor(safeIdx);
  const fx = forecast[date];
  const w = fx ? wx(fx.code) : null;
  const isPinned = !!activeDay?.pinnedRecipe;
  const isSkipped = !!activeDay?.skip;
  const isLiked = m?.data && liked.includes(m.data.name);

  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      {/* Day-rail navigator */}
      <div style={{ display: "flex", gap: "var(--space-1)" }}>
        {days.map((day: any, i: number) => {
          const dm = meals[day.id];
          const isActive = i === safeIdx;
          const isAcc = dm?.status === "accepted";
          const isPinn = !!day.pinnedRecipe;
          const isSkip = !!day.skip;
          const dDate = dateFor(i);
          const wd = parseISO(dDate).toLocaleDateString(undefined, { weekday: "short" });
          return (
            <button key={day.id} onClick={() => setActiveMealIdx(i)} style={{
              flex: "1 1 0", padding: "6px 2px 4px", borderRadius: "var(--radius-sm)", border: "none",
              background: isActive ? "var(--c-primary)" : "var(--c-surface-2)",
              color: isActive ? "var(--c-on-primary)" : "var(--c-text-muted)",
              fontSize: 11, fontWeight: 700, fontFamily: "var(--font-sans)",
              cursor: "pointer", transition: "background .15s", textAlign: "center" as const,
              opacity: isSkip ? 0.5 : 1, lineHeight: 1.2,
            }}>
              {wd}
              {(isAcc || isPinn) && !isActive && (
                <span style={{ display: "block", fontSize: 8, marginTop: 2 }}>✓</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Single meal card */}
      <div style={{
        background: "var(--c-surface)", border: "1px solid var(--c-primary)",
        borderRadius: 12, boxShadow: "0 0 0 1px var(--c-primary)", overflow: "hidden",
      }}>
        {/* Card header: context + accepted badge + compact prev/next */}
        <div style={{
          padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--c-border)",
          display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" as const,
        }}>
          <span style={{
            fontSize: "var(--t-caption-size)", fontWeight: 600, textTransform: "uppercase" as const,
            letterSpacing: ".04em", color: "var(--c-text-muted)", flex: 1, lineHeight: 1.4,
          }}>
            {weekdayLabel(date)}{" · "}{activeDay?.people} ppl{fx ? ` · ${w!.e} ${fx.hi}°F` : ""}
          </span>
          {m?.status === "accepted" && !isPinned && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              background: "var(--c-success-bg)", color: "var(--c-success-text)",
              fontWeight: 700, padding: "4px 9px", borderRadius: 20, fontSize: 11, whiteSpace: "nowrap" as const,
            }}>
              <Check size={11} strokeWidth={2.6} /> Accepted
            </span>
          )}
          {isPinned && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              background: "var(--c-primary)", color: "var(--c-on-primary)",
              fontWeight: 700, padding: "4px 9px", borderRadius: 20, fontSize: 11, whiteSpace: "nowrap" as const,
            }}>
              📌 Pinned
            </span>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <button
              onClick={() => setActiveMealIdx(prev => Math.max(0, prev - 1))}
              disabled={safeIdx === 0}
              className="btn-ghost btn--sm"
              style={{ padding: "0 6px", minHeight: 30, opacity: safeIdx === 0 ? 0.3 : 1 }}
              aria-label="Previous meal"
            ><ChevronLeft size={14} /></button>
            <span style={{
              fontSize: "var(--t-caption-size)", fontWeight: 600, color: "var(--c-text-muted)",
              minWidth: 32, textAlign: "center" as const,
            }}>{safeIdx + 1}/{total}</span>
            <button
              onClick={() => setActiveMealIdx(prev => Math.min(total - 1, prev + 1))}
              disabled={safeIdx === total - 1}
              className="btn-ghost btn--sm"
              style={{ padding: "0 6px", minHeight: 30, opacity: safeIdx === total - 1 ? 0.3 : 1 }}
              aria-label="Next meal"
            ><ChevronRight size={14} /></button>
          </div>
        </div>

        {/* Card body */}
        <div style={{ padding: "var(--space-4)" }}>
          {isSkipped && (
            <p style={{ ...s.empty, fontStyle: "italic" }}>
              This day is marked as skip — no dinner will be generated or added to the grocery list.
            </p>
          )}
          {!isSkipped && !m && <p style={s.empty}>Run "Generate meal plan" from Setup.</p>}
          {m?.status === "loading" && (
            <p style={{ ...s.empty, display: "flex", gap: 8, alignItems: "center" }}>
              <RefreshCw size={15} className="spin" /> Thinking up a dish...
            </p>
          )}
          {m?.status === "error" && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "var(--c-danger)", fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
                <AlertCircle size={15} /> {m.error}
              </span>
              <button onClick={() => onReject(activeDay, safeIdx)} style={s.ghostBtn}>
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          )}
          {m?.data && (m.status === "ready" || m.status === "accepted") && (
            <>
              {/* Recipe identity */}
              {m.data.cuisine && <span style={s.cuisineTag}>{m.data.cuisine}</span>}
              <h2 style={{
                fontSize: 21, lineHeight: "27px", fontWeight: 700, letterSpacing: "-0.01em",
                fontFamily: "var(--font-sans)", margin: "var(--space-3) 0 var(--space-2)",
              }}>{m.data.name}</h2>
              <p style={{
                fontSize: "var(--t-bodysm-size)", lineHeight: "20px",
                color: "var(--c-text-muted)", margin: "0 0 var(--space-4)",
              }}>{m.data.description}</p>

              {/* Meta row: Clock · Flame · Users + effort badge */}
              <div style={{
                display: "flex", flexWrap: "wrap" as const, gap: "var(--space-3)", alignItems: "center",
                paddingBottom: "var(--space-4)", borderBottom: "1px solid var(--c-border)",
              }}>
                {(m.data.prepMinutes != null || m.data.cookMinutes != null) && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--t-bodysm-size)", color: "var(--c-text)" }}>
                    <Clock size={14} color="var(--c-primary)" />
                    {[
                      m.data.prepMinutes != null ? `Prep ${m.data.prepMinutes}` : null,
                      m.data.cookMinutes != null ? `Cook ${m.data.cookMinutes} min` : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                )}
                {m.kcalInfo && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--t-bodysm-size)", color: "var(--c-text)" }}>
                    <Flame size={14} color="var(--c-primary)" />
                    ~{m.kcalInfo.kcalPerServing} kcal
                    {m.kcalInfo.tier === "estimate" && (
                      <span style={{ background: "var(--c-warning-bg)", color: "var(--c-warning)", fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: "var(--radius-pill)", lineHeight: 1 }}>Est.</span>
                    )}
                  </span>
                )}
                {m.data.servings && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--t-bodysm-size)", color: "var(--c-text)" }}>
                    <Users size={14} color="var(--c-primary)" />
                    Serves {m.data.servings}
                  </span>
                )}
                {m.data.difficulty != null && (
                  <span style={{ ...s.rcEffortBadge, marginLeft: "auto" }}>
                    <span style={{ letterSpacing: 1 }}>{"●".repeat(m.data.difficulty) + "○".repeat(Math.max(0, 5 - m.data.difficulty))}</span>
                    {" "}{DIFFICULTY_LABELS[m.data.difficulty] ?? ""}
                  </span>
                )}
              </div>

              {/* Reuse/pantry block — new structured fields if present, else fallback to legacy string */}
              {(m.data.reuseNotes?.length > 0 || m.data.pantryNote) ? (
                <div style={{
                  background: "var(--c-warning-bg)", border: "1px solid rgba(138,109,59,0.18)",
                  borderRadius: "var(--radius-sm)", padding: "var(--space-3) var(--space-4)",
                  margin: "var(--space-4) 0", display: "grid", gap: "var(--space-2)",
                }}>
                  {m.data.reuseNotes?.length > 0 && (
                    <div>
                      <p style={{
                        fontSize: "var(--t-label-size)", fontWeight: 700,
                        letterSpacing: "var(--t-label-tracking)", textTransform: "uppercase" as const,
                        color: "var(--c-warning)", margin: "0 0 var(--space-2)",
                      }}>Reuses this week</p>
                      <div style={{ display: "grid", gap: "var(--space-1)" }}>
                        {m.data.reuseNotes.map((note: string, ni: number) => (
                          <div key={ni} style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-start" }}>
                            <span style={{ fontSize: 13, lineHeight: "18px", color: "var(--c-warning)", flexShrink: 0, marginTop: 1 }}>↺</span>
                            <span style={{ fontSize: "var(--t-bodysm-size)", lineHeight: "18px", color: "var(--c-text)" }}>{note}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {m.data.pantryNote && (
                    <p style={{
                      fontSize: "var(--t-bodysm-size)", color: "var(--c-text-muted)", margin: 0,
                      paddingTop: m.data.reuseNotes?.length > 0 ? "var(--space-1)" : 0,
                      borderTop: m.data.reuseNotes?.length > 0 ? "1px solid rgba(138,109,59,0.14)" : "none",
                    }}>
                      <strong style={{ fontWeight: 700, color: "var(--c-warning)" }}>Pantry: </strong>{m.data.pantryNote}
                    </p>
                  )}
                </div>
              ) : m.data.reuseNote ? (
                <div style={{ ...s.reuseNote, margin: "var(--space-4) 0" }}>
                  <Repeat size={13} /> {m.data.reuseNote}
                </div>
              ) : null}

              {m.data.dietaryAvoid?.length > 0 && (
                <div style={{ ...s.reuseNote, marginBottom: "var(--space-3)" }}>
                  {dietaryDisclaimer(m.data.dietaryAvoid)}
                </div>
              )}

              {/* Ingredients — 3-column rows: name / qty / purchase badge */}
              {m.data.ingredients?.length > 0 && (
                <div style={{ marginTop: "var(--space-4)" }}>
                  <p style={{ ...s.typeLabel, color: "var(--c-text-muted)", margin: "0 0 var(--space-3)" }}>
                    Ingredients · {m.data.ingredients.length}
                  </p>
                  <div>
                    {m.data.ingredients.map((ing: any, idx: number) => {
                      const rStr = fmtRecipeQty(ing);
                      const purchaseType = ing.purchaseType ?? (ing.source === "reused" ? "reuse" : ing.source);
                      const purchaseNote = ing.purchaseNote ?? ing.purchaseSize;
                      const notLast = idx < m.data.ingredients.length - 1;
                      const nsMap: Record<string, { badge: boolean; color: string; bg?: string }> = {
                        buy:    { badge: false, color: "var(--c-text-muted)" },
                        reuse:  { badge: true,  color: "var(--c-success-text)", bg: "var(--c-success-bg)" },
                        staple: { badge: true,  color: "var(--c-warning)",      bg: "var(--c-warning-bg)" },
                      };
                      const ns = nsMap[purchaseType] ?? { badge: false, color: "var(--c-text-muted)" };
                      return (
                        <div key={idx} style={{
                          display: "flex", alignItems: "baseline", gap: "var(--space-2)",
                          padding: "9px 0",
                          borderBottom: notLast ? "1px solid var(--c-surface-2)" : "none",
                        }}>
                          <span style={{ flex: 1, fontWeight: 600, fontSize: "var(--t-body-size)", color: "var(--c-text)" }}>{ing.name}</span>
                          <span style={{ flexShrink: 0, fontSize: "var(--t-caption-size)", color: "var(--c-text-muted)", textAlign: "right" as const, minWidth: 58 }}>{rStr}</span>
                          {purchaseNote && (
                            ns.badge ? (
                              <span style={{
                                flexShrink: 0, fontSize: 10, fontWeight: 600, lineHeight: 1,
                                color: ns.color, background: ns.bg,
                                padding: "2px 6px", borderRadius: "var(--radius-pill)", whiteSpace: "nowrap" as const,
                              }}>{purchaseNote}</span>
                            ) : (
                              <span style={{ flexShrink: 0, fontSize: "var(--t-caption-size)", color: "var(--c-text-muted)", whiteSpace: "nowrap" as const }}>{purchaseNote}</span>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Steps — numbered-badge grid */}
              {m.data.steps?.length > 0 && (
                <div>
                  <hr style={{ height: 1, background: "var(--c-border)", border: "none", margin: "var(--space-4) 0" }} />
                  <p style={{ ...s.typeLabel, color: "var(--c-text-muted)", margin: "0 0 var(--space-4)" }}>
                    How to make it
                  </p>
                  <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-4)" }}>
                    {m.data.steps.map((step: string, si: number) => (
                      <li key={si} style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
                        <span style={{
                          flexShrink: 0, width: 26, height: 26, marginTop: 1,
                          borderRadius: "var(--radius-pill)",
                          background: "var(--c-primary-tint)", color: "var(--c-primary)",
                          display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12,
                        }}>{si + 1}</span>
                        <span style={{ fontSize: "var(--t-body-size)", lineHeight: "22px", color: "var(--c-text)", paddingTop: 3 }}>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Actions row */}
              {!isPinned && (
                <div style={{
                  marginTop: "var(--space-5)", paddingTop: "var(--space-4)",
                  borderTop: "1px solid var(--c-border)",
                  display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" as const,
                }}>
                  {m.status !== "accepted" && (
                    <button onClick={() => onAccept(activeDay.id)} style={s.acceptBtn}>
                      <Check size={15} /> Accept
                    </button>
                  )}
                  <button onClick={() => onReject(activeDay, safeIdx)} style={s.rejectBtn}>
                    <RefreshCw size={14} /> {m.status === "accepted" ? "Swap" : "Reject"}
                  </button>
                  <div style={{ flex: 1 }} />
                  <button
                    onClick={() => onThumbUp(activeDay)}
                    style={{ ...s.thumb, color: isLiked ? "var(--c-primary)" : "var(--c-text-muted)", borderColor: isLiked ? "var(--c-primary)" : "var(--c-border)" }}
                    title="Like"
                  ><ThumbsUp size={15} /></button>
                  <button
                    onClick={() => onThumbDown(activeDay, safeIdx)}
                    style={{ ...s.thumb, color: "var(--c-danger)", borderColor: "var(--c-danger-bg)" }}
                    title="Dislike (avoid + swap)"
                  ><ThumbsDown size={15} /></button>
                  <button onClick={() => onAddRotation(activeDay)} style={s.rotateBtn} title="Save to Recipe Box">
                    <Star size={14} /> Recipe Box
                  </button>
                  <button
                    onClick={() => setActiveMealIdx(prev => Math.min(total - 1, prev + 1))}
                    disabled={safeIdx === total - 1}
                    className="btn-ghost btn--sm"
                    style={{ opacity: safeIdx === total - 1 ? 0.4 : 1 }}
                  >
                    {safeIdx === total - 1 ? "All reviewed ✓" : `Next: ${weekdayLabel(dateFor(safeIdx + 1)).split(",")[0]} →`}
                  </button>
                </div>
              )}
              {isPinned && (
                <p style={{ fontSize: 12, color: "var(--c-text-muted)", marginTop: 10, fontStyle: "italic" }}>
                  Pinned in Setup — unpin there to enable generation or swapping.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* All meals accepted gate */}
      {acceptedCount > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" as const, marginTop: 8 }}>
          <button onClick={onAllAccepted} className="btn-primary">
            <CalendarDays size={15} /> Save to This Week
          </button>
          <button onClick={() => window.print()} className="btn-ghost btn--sm">
            <Printer size={14} /> Print recipes
          </button>
        </div>
      )}
    </div>
  );
}

/* ============================ List ============================ */
function ListView({ groceryList, totalItems, listText, pantry, setPantry, checkedItems, setCheckedItems, weekAdditions, setWeekAdditions, acceptedCount, slotCount, location, onMarkOrdered, alwaysHave, setAlwaysHave, session, qualificationNumber, setQualificationNumber }: any) {
  const isMobile = useIsMobile();
  const [copied, setCopied] = useState(false);
  const [copiedCart, setCopiedCart] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [newAlwaysHave, setNewAlwaysHave] = useState("");
  const [addName, setAddName] = useState("");
  const [addQty, setAddQty] = useState("");
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
    setWeekAdditions((prev: any[]) => [...prev, { id: uid(), name, qty: addQty.trim() }]);
    setAddName(""); setAddQty("");
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
    if (!window.confirm("Archive this plan and start next week?\n\nYour meals, grocery list, and This Week box will be cleared. Setup, staples, and preferences are kept.")) return;
    setOrdering(true);
    setOrderError(null);
    const { error } = await onMarkOrdered();
    setOrdering(false);
    if (error) setOrderError(error);
  };
  const togglePantry = (n: string) => { const k = n.toLowerCase(); setPantry((p: string[]) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]); };
  const toggleCheck = (k: string) => setCheckedItems((p: any) => ({ ...p, [k]: !p[k] }));
  const toggleAlwaysHave = (name: string) => {
    const k = normalizeIngName(name);
    setAlwaysHave((p: string[]) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]);
  };
  const addAlwaysHave = () => {
    const k = normalizeIngName(newAlwaysHave);
    if (!k) return;
    setAlwaysHave((p: string[]) => p.includes(k) ? p : [...p, k]);
    setNewAlwaysHave("");
  };

  const catalogPriceMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of catalog) {
      if (row.normalized_name && row.last_price_cents != null) {
        m.set(normalizeIngName(row.normalized_name), row.last_price_cents);
      }
    }
    return m;
  }, [catalog]);

  const priceEstimate = useMemo(() => {
    let sumCents = 0;
    let pricedCount = 0;
    for (const cat of CATEGORIES) {
      for (const it of (groceryList[cat] ?? [])) {
        if (!it.isPurchaseStyle) continue;
        const price = catalogPriceMap.get(normalizeIngName(it.name));
        if (price == null) continue;
        sumCents += price * it.qty;
        pricedCount++;
      }
    }
    return { sumCents, pricedCount };
  }, [groceryList, catalogPriceMap]);

  return (
    <div>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "var(--space-4)" }}>
          <h1 style={{ ...s.typeH1, margin: 0 }}>Grocery list</h1>
          <p style={{ ...s.typeBodySm, color: "var(--c-text-muted)", margin: "2px 0 0" }}>
            {totalItems} items · {acceptedCount}/{slotCount} dinners + staples
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

        {/* Always Have sunken panel */}
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

        {/* Category cards */}
        {totalItems === 0 ? (
          <div style={s.card}><p style={s.empty}>Accept dinners to build the list (staples always included).</p></div>
        ) : (
          <div style={{ display: "grid", gap: "var(--space-4)" }}>
            {CATEGORIES.map((cat) => {
              const items = groceryList[cat]; if (!items?.length) return null;
              return (
                <div key={cat} style={s.lvCatCard}>
                  <h3 style={s.lvCatTitle}>{cat}</h3>
                  <div>
                    {items.map((it: any) => {
                      const key = `${it.name}|${it.unit}`;
                      const checked = !!checkedItems[key];
                      const isP = pantry.includes(it.name.toLowerCase());
                      const isAH = alwaysHave.includes(normalizeIngName(it.name));
                      const itemPrice = catalogPriceMap.get(normalizeIngName(it.name));
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
                            {it.isPurchaseStyle && itemPrice != null && (
                              <span style={{ ...s.typeCaption, color: "var(--c-text-muted)", marginLeft: 4 }}>${(itemPrice / 100).toFixed(2)} ea</span>
                            )}
                            {it.staple && <span style={s.lvStaple}>staple</span>}
                          </span>
                          <button
                            onClick={() => togglePantry(it.name)}
                            style={{ ...s.lvHaveIt, color: isP || isAH ? "var(--c-on-primary)" : "var(--c-text-muted)", background: isP || isAH ? "var(--c-primary)" : "transparent", borderColor: isP || isAH ? "var(--c-primary)" : "var(--c-border)" }}
                          >have it</button>
                          <button
                            onClick={() => toggleAlwaysHave(it.name)}
                            style={{ ...s.lvStar, color: isAH ? "var(--c-warning)" : "var(--c-border)" }}
                            title={isAH ? "Remove from always have" : "Always have (auto-excluded every week)"}
                          >
                            <Star size={17} fill={isAH ? "var(--c-warning)" : "none"} />
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

        {/* Added by you */}
        <div style={{ marginTop: "var(--space-4)" }}>
          <div style={s.lvCatCard}>
            <h3 style={s.lvCatTitle}>Added by you</h3>
            {weekAdditions.length > 0 && (
              <div style={{ marginBottom: "var(--space-3)" }}>
                {weekAdditions.map((it: any) => {
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
                      </span>
                      <button
                        onClick={() => setWeekAdditions((prev: any[]) => prev.filter((x: any) => x.id !== it.id))}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--c-text-muted)", display: "grid", lineHeight: 1 }}
                        aria-label="Remove item"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
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
              <button onClick={handleAddItem} disabled={!addName.trim()} style={{ ...s.addBtn, opacity: addName.trim() ? 1 : 0.45 }}>
                <Plus size={14} /> Add
              </button>
            </div>
          </div>
        </div>

        {/* Price estimate footer */}
        {session && priceEstimate.pricedCount > 0 && (
          <div style={s.lvFooter}>
            <strong style={{ ...s.typeBody, color: "var(--c-success-text)", fontWeight: 700 }}>
              Est. ${(priceEstimate.sumCents / 100).toFixed(2)}
            </strong>
            <span style={{ ...s.typeBodySm, color: "var(--c-text-muted)" }}>
              {" "}— {priceEstimate.pricedCount} of {totalItems} items priced · recent ALDI prices, not a quote
            </span>
          </div>
        )}

        {/* Archive action */}
        {orderError && <p style={{ color: "var(--c-danger)", fontSize: 12, margin: "8px 0 4px" }}>Could not archive: {orderError}</p>}
        <button
          onClick={markOrdered}
          disabled={acceptedCount === 0 || ordering}
          className="btn-ghost btn--sm btn--block"
          style={{ marginTop: "var(--space-4)" }}
        >
          {ordering ? <RefreshCw size={14} className="spin" /> : <Archive size={14} />}
          {ordering ? "Archiving..." : "Mark ordered & start next week"}
        </button>
      </div>
    </div>
  );
}

/* ============================ Manual Recipe Form ============================ */
type IngRow = { id: string; name: string; rQty: string; rUnit: string; purchaseSize: string; purchaseQty: string; category: string };

function ManualRecipeForm({ rotation, onSave, onCancel }: { rotation: any[]; onSave: (data: any) => void; onCancel: () => void }) {
  const isMobile = useIsMobile();
  const [recipeName, setRecipeName] = useState("");
  const [description, setDescription] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [servings, setServings] = useState("4");
  const [prepMinutes, setPrepMinutes] = useState("0");
  const [cookMinutes, setCookMinutes] = useState("0");
  const [estKcal, setEstKcal] = useState("");
  const [difficulty, setDifficulty] = useState(2);
  const [steps, setSteps] = useState<{ id: string; text: string }[]>([{ id: uid(), text: "" }]);
  const [ings, setIngs] = useState<IngRow[]>([{ id: uid(), name: "", rQty: "", rUnit: "", purchaseSize: "", purchaseQty: "1", category: "Produce" }]);
  const [errors, setErrors] = useState<string[]>([]);

  const addStep = () => setSteps(p => [...p, { id: uid(), text: "" }]);
  const removeStep = (id: string) => setSteps(p => p.filter(s => s.id !== id));
  const updateStep = (id: string, text: string) => setSteps(p => p.map(s => s.id === id ? { ...s, text } : s));

  const addIng = () => setIngs(p => [...p, { id: uid(), name: "", rQty: "", rUnit: "", purchaseSize: "", purchaseQty: "1", category: "Produce" }]);
  const removeIng = (id: string) => setIngs(p => p.filter(i => i.id !== id));
  const patchIng = (id: string, patch: Partial<IngRow>) => setIngs(p => p.map(i => i.id === id ? { ...i, ...patch } : i));

  const validate = (): string[] => {
    const errs: string[] = [];
    const trimName = recipeName.trim();
    if (!trimName) errs.push("Recipe name is required.");
    const srv = Number(servings);
    if (!Number.isFinite(srv) || srv < 1) errs.push("Servings must be at least 1.");
    const validIngs = ings.filter(i => i.name.trim());
    if (validIngs.length === 0) errs.push("Add at least one ingredient.");
    for (const ing of validIngs) {
      if (!ing.purchaseSize.trim()) errs.push(`"${ing.name.trim()}" needs a purchase size (e.g. "2 lb bag").`);
    }
    if (trimName && rotation.some((r: any) => r.name.toLowerCase() === trimName.toLowerCase())) {
      errs.push(`"${trimName}" is already in your rotation — use a different name or remove the existing one first.`);
    }
    return errs;
  };

  const handleSave = () => {
    const errs = validate();
    if (errs.length) { setErrors(errs); return; }
    setErrors([]);
    const srv = Math.max(1, Math.round(Number(servings)));
    const validIngs = ings.filter(i => i.name.trim());
    const data: Record<string, any> = {
      name: recipeName.trim(),
      servings: srv,
      prepMinutes: Math.round(Number(prepMinutes) || 0),
      cookMinutes: Math.round(Number(cookMinutes) || 0),
      difficulty: Math.min(5, Math.max(0, difficulty)),
      steps: steps.map(s => s.text.trim()).filter(Boolean),
      ingredients: validIngs.map(i => ({
        name: i.name.trim(),
        recipeAmount: { qty: Number(i.rQty) || 0, unit: i.rUnit.trim() },
        purchaseSize: i.purchaseSize.trim(),
        purchaseQty: Math.max(1, Math.round(Number(i.purchaseQty) || 1)),
        category: CATEGORIES.includes(i.category) ? i.category : "Other",
      })),
    };
    if (description.trim()) data.description = description.trim();
    if (cuisine.trim()) data.cuisine = cuisine.trim();
    const kcal = Math.round(Number(estKcal));
    if (kcal > 0) data.estKcalPerServing = kcal;
    onSave(data);
  };

  const diffLabels = ["Premade", "Minimal", "Simple", "Moderate", "Involved", "Intricate"];

  return (
    <div style={{ ...s.card, display: "grid", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={s.cardTitle}>New recipe</h3>
        <button onClick={onCancel} style={s.iconBtn}><X size={16} color="var(--c-text-muted)" /></button>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <div>
          <label style={s.fieldLabel}>Recipe name *</label>
          <input value={recipeName} onChange={e => setRecipeName(e.target.value)} placeholder="e.g. One-Pan Chicken Thighs" style={{ ...s.input, width: "100%" }} />
        </div>
        <div>
          <label style={s.fieldLabel}>Description <span style={{ fontWeight: 400, textTransform: "none" as const }}>(optional)</span></label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="One short sentence" style={{ ...s.input, width: "100%" }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: isMobile ? "wrap" as const : undefined }}>
          <div style={{ flex: 1, minWidth: 100 }}>
            <label style={s.fieldLabel}>Cuisine <span style={{ fontWeight: 400, textTransform: "none" as const }}>(optional)</span></label>
            <input value={cuisine} onChange={e => setCuisine(e.target.value)} placeholder="e.g. Italian" style={{ ...s.input, width: "100%" }} />
          </div>
          <div style={{ width: isMobile ? "100%" : 80 }}>
            <label style={s.fieldLabel}>Servings *</label>
            <input type="number" min={1} value={servings} onChange={e => setServings(e.target.value)} style={{ ...s.input, width: "100%", textAlign: "center" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: isMobile ? "wrap" as const : undefined }}>
          <div style={{ flex: 1, minWidth: isMobile ? "40%" : 80 }}>
            <label style={s.fieldLabel}>Prep (min)</label>
            <input type="number" min={0} value={prepMinutes} onChange={e => setPrepMinutes(e.target.value)} style={{ ...s.input, width: "100%", textAlign: "center" }} />
          </div>
          <div style={{ flex: 1, minWidth: isMobile ? "40%" : 80 }}>
            <label style={s.fieldLabel}>Cook (min)</label>
            <input type="number" min={0} value={cookMinutes} onChange={e => setCookMinutes(e.target.value)} style={{ ...s.input, width: "100%", textAlign: "center" }} />
          </div>
          <div style={{ flex: 1, minWidth: isMobile ? "40%" : 100 }}>
            <label style={s.fieldLabel}>Est. kcal/serving</label>
            <input type="number" min={0} value={estKcal} onChange={e => setEstKcal(e.target.value)} placeholder="optional" style={{ ...s.input, width: "100%", textAlign: "center" }} />
          </div>
        </div>
      </div>

      <div>
        <label style={s.fieldLabel}>Difficulty</label>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" as const, marginTop: 4 }}>
          {diffLabels.map((label, i) => (
            <button
              key={i}
              onClick={() => setDifficulty(i)}
              style={{
                padding: "5px 10px", borderRadius: 20, cursor: "pointer",
                border: difficulty === i ? "none" : "1px solid var(--c-border)",
                background: difficulty === i ? "var(--c-primary)" : "var(--c-surface-2)",
                color: difficulty === i ? "var(--c-on-primary)" : "var(--c-text-muted)",
                fontFamily: "var(--font-sans, inherit)", fontSize: 12, fontWeight: 600,
              }}
            >
              {i} · {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label style={s.fieldLabel}>Steps</label>
        <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
          {steps.map((step, idx) => (
            <div key={step.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ ...s.miniLabel, width: 18, flexShrink: 0, textAlign: "center" as const }}>{idx + 1}</span>
              <input
                value={step.text}
                onChange={e => updateStep(step.id, e.target.value)}
                placeholder={`Step ${idx + 1}`}
                style={{ ...s.input, flex: 1 }}
              />
              {steps.length > 1 && (
                <button onClick={() => removeStep(step.id)} style={s.iconBtn}><X size={13} color="var(--c-text-muted)" /></button>
              )}
            </div>
          ))}
        </div>
        <button onClick={addStep} style={{ ...s.addBtn, marginTop: 8 }}><Plus size={14} /> Add step</button>
      </div>

      <div>
        <label style={s.fieldLabel}>Ingredients *</label>
        <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
          {ings.map((ing) => (
            <div key={ing.id} style={{ ...s.dayBlock, display: "grid", gap: 6 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  value={ing.name}
                  onChange={e => patchIng(ing.id, { name: e.target.value })}
                  placeholder="Ingredient name"
                  style={{ ...s.input, flex: 1 }}
                />
                {ings.length > 1 && (
                  <button onClick={() => removeIng(ing.id)} style={s.iconBtn}><X size={13} color="var(--c-danger)" /></button>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <span style={{ ...s.miniLabel, whiteSpace: "nowrap" as const }}>Recipe</span>
                  <input type="number" min={0} step="any" value={ing.rQty} onChange={e => patchIng(ing.id, { rQty: e.target.value })} placeholder="qty" style={{ ...s.input, width: 52, textAlign: "center", fontSize: 12 }} />
                  <input value={ing.rUnit} onChange={e => patchIng(ing.id, { rUnit: e.target.value })} placeholder="unit" style={{ ...s.input, width: 64, fontSize: 12 }} />
                </div>
                <div style={{ display: "flex", gap: 4, alignItems: "center", flex: 1, minWidth: 140 }}>
                  <span style={{ ...s.miniLabel, whiteSpace: "nowrap" as const }}>Buy</span>
                  <input value={ing.purchaseSize} onChange={e => patchIng(ing.id, { purchaseSize: e.target.value })} placeholder='e.g. "2 lb bag" *' style={{ ...s.input, flex: 1, fontSize: 12 }} />
                  <input type="number" min={1} value={ing.purchaseQty} onChange={e => patchIng(ing.id, { purchaseQty: e.target.value })} style={{ ...s.input, width: 44, textAlign: "center", fontSize: 12 }} />
                </div>
                <select
                  value={ing.category}
                  onChange={e => patchIng(ing.id, { category: e.target.value })}
                  style={{ ...s.input, fontSize: 12, flex: 1, minWidth: 100 }}
                >
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
        <button onClick={addIng} style={{ ...s.addBtn, marginTop: 8 }}><Plus size={14} /> Add ingredient</button>
      </div>

      {errors.length > 0 && (
        <div style={{ background: "var(--c-danger-bg)", borderRadius: 8, padding: "10px 12px", display: "grid", gap: 4 }}>
          {errors.map((e, i) => (
            <p key={i} style={{ margin: 0, fontSize: 13, color: "var(--c-danger)", display: "flex", gap: 5, alignItems: "flex-start" }}>
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {e}
            </p>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
        <button onClick={handleSave} style={s.primaryBtn}><Check size={15} /> Save recipe</button>
        <button onClick={onCancel} style={s.ghostBtn}><X size={14} /> Cancel</button>
      </div>
    </div>
  );
}

/* ============================ Rotation ============================ */
function RotationView({ rotation, setRotation, liked, setLiked, avoid, setAvoid, recipeStars, setRecipeStars }: any) {
  const [showForm, setShowForm] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const handleSaveManual = (data: any) => {
    setRotation((p: any[]) => [...p, data]);
    if (data.name) setLiked((p: string[]) => p.includes(data.name) ? p : [...p, data.name]);
    setShowForm(false);
  };

  if (selectedIdx !== null && rotation[selectedIdx]) {
    return (
      <div>
        <button className="btn-ghost btn--sm" style={{ marginBottom: "var(--space-4)" }} onClick={() => setSelectedIdx(null)}>
          ← Back to Recipe Box
        </button>
        <RecipeCard
          meal={rotation[selectedIdx]}
          onSaveRotation={() => setSelectedIdx(null)}
        />
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={s.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={s.cardTitle}>Recipe Box <span style={s.cardSub}>- saved favorites the planner leans toward</span></h3>
          <button onClick={() => setShowForm(v => !v)} style={s.addBtn}><Plus size={14} /> Add recipe</button>
        </div>
        {rotation.length === 0 && !showForm
          ? <p style={{ ...s.empty, marginTop: 8 }}>Tap "Recipe Box" on a meal you love to save it here.</p>
          : rotation.length > 0 && (
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {rotation.map((r: any, i: number) => {
                const rating = recipeStars[r.name] ?? 0;
                return (
                  <div key={i} style={s.rotItem}>
                    <button onClick={() => setSelectedIdx(i)} style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0, flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "var(--c-text)" }}>{r.name}</div>
                      <div style={s.cardSub}>{r.cuisine ? `${r.cuisine} · ` : ""}{r.ingredients?.length ?? 0} ingredients</div>
                    </button>
                    <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                      {[1, 2, 3, 4, 5].map(n => (
                        <button
                          key={n}
                          onClick={() => setRecipeStars((prev: Record<string, number>) => {
                            const next = { ...prev };
                            if (next[r.name] === n) delete next[r.name];
                            else next[r.name] = n;
                            return next;
                          })}
                          style={{ ...s.starBtn, color: n <= rating ? "var(--c-warning)" : "var(--c-border)" }}
                          title={n <= rating && n === rating ? "Clear rating" : `Rate ${n} star${n > 1 ? "s" : ""}`}
                        >★</button>
                      ))}
                    </div>
                    <button onClick={() => setRotation((p: any[]) => p.filter((_, idx) => idx !== i))} style={s.iconBtn}><Trash2 size={15} color="var(--c-danger)" /></button>
                  </div>
                );
              })}
            </div>
          )
        }
      </div>

      {showForm && (
        <ManualRecipeForm
          rotation={rotation}
          onSave={handleSaveManual}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div style={s.card}><h3 style={s.cardTitle}>Liked styles</h3><ChipManager items={liked} onRemove={(x: string) => setLiked((p: string[]) => p.filter((i) => i !== x))} empty="Thumbs-up meals show up here." tone="green" /></div>
      <div style={s.card}><h3 style={s.cardTitle}>Avoiding</h3><ChipManager items={avoid} onRemove={(x: string) => setAvoid((p: string[]) => p.filter((i) => i !== x))} empty="Thumbs-down meals get added here." tone="red" /></div>
    </div>
  );
}
/* ============================ Today / Cook Mode (TER-329) ============================ */
function TodayCook({
  currentWeek, forecast, isMobile,
  cookProgress, setCookProgress,
  recipeStars, setRecipeStars,
  liked, setLiked, avoid, setAvoid,
  pantry, alwaysHave,
}: any) {
  const today = isoToday();
  const entries: any[] = currentWeek?.entries ?? [];
  const cookableEntries = entries.filter((e: any) => !e.skip);

  const [activeDate, setActiveDate] = useState(() => {
    if (!cookableEntries.length) return today;
    return cookableEntries.find((e: any) => e.date === today)?.date ?? cookableEntries[0].date;
  });
  const [hoverStar, setHoverStar] = useState(0);

  if (!currentWeek || !entries.length) {
    return (
      <div style={{ padding: "var(--space-7)", textAlign: "center" as const }}>
        <p style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-body-size)", color: "var(--c-text-muted)", lineHeight: "var(--t-body-lh)" }}>
          No plan for this week yet — head to Planning to generate dinners.
        </p>
      </div>
    );
  }

  const activeIdx = Math.max(0, entries.findIndex((e: any) => e.date === activeDate));
  const activeEntry = entries[activeIdx];
  const meal = activeEntry?.meal;
  const data = meal?.data;

  const defaultProg = { gathered: [] as number[], done: [] as number[], servings: data?.servings ?? 2, made: false };
  const prog = { ...defaultProg, ...(cookProgress[activeDate] ?? {}) };
  const gathered: number[] = prog.gathered ?? [];
  const done: number[] = prog.done ?? [];
  const servings: number = prog.servings || data?.servings || 2;
  const made: boolean = prog.made ?? false;

  const setProgress = (updates: Record<string, any>) =>
    setCookProgress((p: any) => ({ ...p, [activeDate]: { ...defaultProg, ...(p[activeDate] ?? {}), ...updates } }));

  const name: string = data?.name ?? "";
  const stars: number = recipeStars[name] ?? 0;
  const onRate = (r: number) => {
    setRecipeStars((p: any) => ({ ...p, [name]: r }));
    if (r >= 4) {
      setLiked((p: string[]) => (p.includes(name) ? p : [...p, name]));
      setAvoid((p: string[]) => p.filter((x: string) => x !== name));
    } else if (r <= 2) {
      setAvoid((p: string[]) => (p.includes(name) ? p : [...p, name]));
      setLiked((p: string[]) => p.filter((x: string) => x !== name));
    } else {
      // r === 3 → neutral: clear any prior nudge in both directions
      setLiked((p: string[]) => p.filter((x: string) => x !== name));
      setAvoid((p: string[]) => p.filter((x: string) => x !== name));
    }
  };

  const ingredients: any[] = data?.ingredients ?? [];
  const steps: string[] = data?.steps ?? [];
  const currentStep = steps.findIndex((_: any, i: number) => !done.includes(i));
  const allDone = steps.length > 0 && done.length === steps.length;

  const isIngStaple = (ing: any): boolean =>
    alwaysHave.includes(normalizeIngName(ing.name ?? "")) ||
    pantry.includes((ing.name ?? "").toLowerCase());

  const dayLabel = activeDate === today ? "Tonight" : activeDate > today ? "Upcoming" : "Earlier";
  const fxDay = forecast[activeDate];
  const wxDay = fxDay ? wx(fxDay.code) : null;

  const totalMin = (data?.prepMinutes ?? 0) + (data?.cookMinutes ?? 0);
  const difficulty: number | null = data?.difficulty ?? null;
  const diffLabel = difficulty != null ? (DIFFICULTY_LABELS[difficulty] ?? "") : "";
  const kcal = meal?.kcalInfo?.kcalPerServing ?? null;

  const nextCookable = cookableEntries.find((e: any) => e.date > activeDate);

  const footerBase: React.CSSProperties = { position: "sticky", bottom: 0, background: "var(--c-surface)", borderTop: "1px solid var(--c-border)", padding: "var(--space-4) var(--space-5)", boxShadow: "0 -2px 10px rgba(26,58,52,.05)" };

  return (
    <div style={{ minHeight: "100%", background: "var(--c-bg)", display: "flex", flexDirection: "column" }}>
      {/* ── DAY BAR ── */}
      <div style={{ background: "var(--c-surface)", borderBottom: "1px solid var(--c-border)", padding: "var(--space-4) var(--space-5)", boxShadow: "var(--elev-1)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "var(--space-3)" }}>
          <div>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-label-size)", fontWeight: 700, letterSpacing: "var(--t-label-tracking)", textTransform: "uppercase", color: "var(--c-primary)", margin: 0 }}>{dayLabel}</p>
            <h1 style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-h1-size)", fontWeight: 700, letterSpacing: "-0.01em", lineHeight: "var(--t-h1-lh)", color: "var(--c-text)", margin: "2px 0 0", whiteSpace: "nowrap" }}>{weekdayLabel(activeDate)}</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexShrink: 0 }}>
            {wxDay && fxDay && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--c-surface-2)", border: "1px solid var(--c-border)", borderRadius: "var(--radius-pill)", padding: "7px 11px", fontSize: "var(--t-bodysm-size)", fontFamily: "var(--font-sans)", color: "var(--c-text)" }}>
                <span style={{ fontSize: 14 }}>{wxDay.e}</span>{fxDay.hi}°F
              </span>
            )}
            <button onClick={() => window.print()} className="btn-ghost btn--sm" aria-label="Print recipes" style={{ padding: "0 var(--space-2)", minHeight: 34 }}>
              <Printer size={15} />
            </button>
          </div>
        </div>
        {/* prev / rail / next */}
        <div style={{ display: "flex", alignItems: "stretch", gap: "var(--space-2)" }}>
          <button onClick={() => { const prev = entries[activeIdx - 1]; if (prev) setActiveDate(prev.date); }} disabled={activeIdx === 0}
            aria-label="Previous day" className="btn-ghost btn--sm" style={{ minHeight: 0, padding: "0 8px" }}>
            <ChevronLeft size={18} strokeWidth={2.2} />
          </button>
          <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", gap: 3, overflow: "hidden" }}>
              {entries.map((entry: any) => {
                const isActive = entry.date === activeDate;
                const isPast = entry.date < today;
                const isToday = entry.date === today;
                const d = parseISO(entry.date);
                const wd = d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3);
                const dayNum = d.getDate();
                const entryFx = forecast[entry.date];
                const entryWx = entryFx ? wx(entryFx.code) : null;
                return (
                  <button key={entry.date} onClick={() => { if (!entry.skip) setActiveDate(entry.date); }} disabled={entry.skip}
                    style={{
                      flex: "1 1 0", minWidth: 0, cursor: entry.skip ? "default" : "pointer",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                      padding: "7px 2px 6px", borderRadius: "var(--radius-md)",
                      border: `1px solid ${isActive ? "var(--c-primary)" : "transparent"}`,
                      background: isActive ? "var(--c-primary)" : (entry.skip || isPast) ? "transparent" : "var(--c-surface-2)",
                      color: isActive ? "var(--c-on-primary)" : "var(--c-text-muted)",
                      opacity: (isPast && !isActive) || (entry.skip && !isActive) ? 0.55 : 1,
                      transition: "background .15s, color .15s",
                    }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" as const, fontFamily: "var(--font-sans)", opacity: 0.75 }}>{wd}</span>
                    <span style={{ fontWeight: 600, fontSize: 17, lineHeight: 1, fontFamily: "var(--font-sans)" }}>{dayNum}</span>
                    {entry.skip ? (
                      <span style={{ fontSize: 9, fontFamily: "var(--font-sans)", opacity: 0.6 }}>skip</span>
                    ) : isPast ? (
                      <Check size={10} strokeWidth={3} />
                    ) : (
                      <span style={{ fontSize: 11 }}>{entryWx?.e ?? ""}</span>
                    )}
                    {isToday && <span style={{ width: 4, height: 4, borderRadius: 4, background: isActive ? "var(--c-on-primary)" : "var(--c-accent)" }} />}
                  </button>
                );
              })}
            </div>
          </div>
          <button onClick={() => { const next = entries[activeIdx + 1]; if (next) setActiveDate(next.date); }} disabled={activeIdx >= entries.length - 1}
            aria-label="Next day" className="btn-ghost btn--sm" style={{ minHeight: 0, padding: "0 8px" }}>
            <ChevronRight size={18} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* ── SKIPPED / NO DATA ── */}
      {activeEntry?.skip ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-7)" }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-body-size)", color: "var(--c-text-muted)", fontStyle: "italic", textAlign: "center" }}>No dinner planned for this day.</p>
        </div>
      ) : !data ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-7)" }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-body-size)", color: "var(--c-text-muted)", textAlign: "center" }}>Recipe data not available for this day.</p>
        </div>
      ) : (
        <>
          {/* ── RECIPE BODY ── */}
          <div style={{ flex: 1, padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-5)", overflowX: "hidden" }}>
            {data.provenance ? (
              <div style={{ display: "flex", gap: "var(--space-3)", background: "var(--c-surface)", border: "1px solid var(--c-border)", borderLeft: "3px solid var(--c-primary)", borderRadius: "var(--radius-sm)", padding: "var(--space-3) var(--space-4)", fontFamily: "var(--font-sans)" }}>
                <Info size={15} color="var(--c-primary)" style={{ flexShrink: 0, marginTop: 2 }} />
                <p style={{ margin: 0, fontSize: "var(--t-bodysm-size)", lineHeight: "var(--t-bodysm-lh)", fontWeight: 400, color: "var(--c-text)" }}>
                  <strong style={{ fontWeight: 700 }}>Good to know · </strong>{data.provenance}
                </p>
              </div>
            ) : data.reuseNote ? (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "var(--c-warning-bg)", border: "1px solid var(--c-warning-bg)", color: "var(--c-warning)", fontSize: "var(--t-bodysm-size)", lineHeight: "var(--t-bodysm-lh)", padding: "10px 13px", borderRadius: "var(--radius-md)", fontFamily: "var(--font-sans)" }}>
                <Repeat size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                <span><strong style={{ fontWeight: 700 }}>Good to know: </strong>{data.reuseNote}</span>
              </div>
            ) : null}
            <div>
              <span style={{ display: "inline-block", background: "var(--c-accent)", color: "var(--c-pill-text)", fontSize: "var(--t-caption-size)", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" as const, padding: "4px 10px", borderRadius: "var(--radius-pill)", fontFamily: "var(--font-sans)" }}>
                {data.cuisine}
              </span>
              <h2 style={{ marginTop: "var(--space-3)", fontSize: isMobile ? 21 : 24, lineHeight: isMobile ? "27px" : "30px", fontWeight: 600, letterSpacing: "-0.01em", fontFamily: "var(--font-sans)", color: "var(--c-text)" }}>
                {data.name}
              </h2>
              <p style={{ marginTop: "var(--space-2)", fontFamily: "var(--font-sans)", fontSize: "var(--t-bodysm-size)", lineHeight: "var(--t-bodysm-lh)", color: "var(--c-text-muted)" }}>
                {data.description}
              </p>
              {/* Meta row */}
              <div style={{ marginTop: "var(--space-4)", display: "flex", flexWrap: "wrap", gap: "var(--space-4)", alignItems: "center" }}>
                {totalMin > 0 && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-sans)", fontSize: "var(--t-bodysm-size)", color: "var(--c-text)" }}>
                    <Clock size={15} color="var(--c-primary)" strokeWidth={1.8} />{totalMin} min
                  </span>
                )}
                {kcal && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-sans)", fontSize: "var(--t-bodysm-size)", color: "var(--c-text)" }}>
                    <Flame size={15} color="var(--c-primary)" strokeWidth={1.8} />~{kcal} kcal
                  </span>
                )}
                {difficulty != null && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--c-surface-2)", border: "1px solid var(--c-border)", borderRadius: "var(--radius-pill)", padding: "3px 10px", fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", color: "var(--c-text)" }}>
                    <span style={{ letterSpacing: 1 }}>{"●".repeat(difficulty)}{"○".repeat(5 - difficulty)}</span>{" "}{diffLabel}
                  </span>
                )}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto", fontFamily: "var(--font-sans)", fontSize: "var(--t-bodysm-size)", color: "var(--c-text)" }}>
                  <Users size={15} color="var(--c-primary)" strokeWidth={1.8} />
                  Serves {data.servings ?? servings}
                </span>
              </div>
            </div>

            <hr style={{ border: "none", borderTop: "1px solid var(--c-border)", margin: 0 }} />

            {/* ── Two-column (tablet) / stacked (mobile) ── */}
            <div style={isMobile ? { display: "grid", gap: "var(--space-6)" } : { display: "grid", gridTemplateColumns: "0.85fr 1.25fr", gap: "var(--space-7)", alignItems: "start" }}>
              {/* ── GATHER ── */}
              <div>
                <p style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-label-size)", fontWeight: 700, letterSpacing: "var(--t-label-tracking)", textTransform: "uppercase" as const, color: "var(--c-text-muted)", margin: "0 0 var(--space-3)" }}>
                  Gather · {gathered.length}/{ingredients.length}
                </p>
                {(() => {
                  const prepared = ingredients.filter((ing: any) => ing.preparedEarlier === true);
                  const remaining = ingredients.filter((ing: any) => ing.preparedEarlier !== true);
                  const renderIngRow = (ing: any, i: number) => {
                    const on = gathered.includes(i);
                    const qtyStr = fmtRecipeQty(ing);
                    const staple = isIngStaple(ing);
                    return (
                      <li key={i}>
                        <button onClick={() => setProgress({ gathered: on ? gathered.filter((x: number) => x !== i) : [...gathered, i] })}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: "var(--space-3)", minHeight: 46, background: "transparent", border: "none", borderBottom: "1px dashed var(--c-border)", cursor: "pointer", textAlign: "left" as const, padding: "4px 0" }}>
                          <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 6, border: `2px solid ${on ? "var(--c-primary)" : "var(--c-border)"}`, background: on ? "var(--c-primary)" : "transparent", display: "grid", placeItems: "center", transition: "background .12s, border-color .12s" }}>
                            {on && <Check size={13} color="var(--c-on-primary)" strokeWidth={2.8} />}
                          </span>
                          <span style={{ flex: 1, fontFamily: "var(--font-sans)", fontSize: "var(--t-body-size)", textDecoration: on ? "line-through" : "none", color: on ? "var(--c-text-muted)" : "var(--c-text)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const }}>
                            {ing.name}
                            {(staple || ing.source === "staple") && <span style={{ display: "inline-block", background: "var(--c-warning-bg)", color: "var(--c-warning)", fontSize: "var(--t-caption-size)", fontWeight: 600, padding: "1px 7px", borderRadius: "var(--radius-pill)", fontFamily: "var(--font-sans)", flexShrink: 0 }}>pantry</span>}
                          </span>
                          <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-bodysm-size)", color: "var(--c-text-muted)", flexShrink: 0 }}>{qtyStr}</span>
                        </button>
                      </li>
                    );
                  };
                  if (prepared.length === 0) {
                    return (
                      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-1)" }}>
                        {ingredients.map((ing: any, i: number) => renderIngRow(ing, i))}
                      </ul>
                    );
                  }
                  return (
                    <>
                      <p style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", fontWeight: 700, letterSpacing: "var(--t-label-tracking)", textTransform: "uppercase" as const, color: "var(--c-text-muted)", margin: "0 0 var(--space-1)" }}>Prepared earlier this week</p>
                      <ul style={{ listStyle: "none", margin: "0 0 var(--space-3)", padding: 0, display: "grid", gap: "var(--space-1)" }}>
                        {prepared.map((ing: any) => renderIngRow(ing, ingredients.indexOf(ing)))}
                      </ul>
                      <p style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", fontWeight: 700, letterSpacing: "var(--t-label-tracking)", textTransform: "uppercase" as const, color: "var(--c-text-muted)", margin: "0 0 var(--space-1)" }}>Remaining ingredients</p>
                      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-1)" }}>
                        {remaining.map((ing: any) => renderIngRow(ing, ingredients.indexOf(ing)))}
                      </ul>
                    </>
                  );
                })()}
              </div>

              {/* ── COOK ── */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-3)" }}>
                  <p style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-label-size)", fontWeight: 700, letterSpacing: "var(--t-label-tracking)", textTransform: "uppercase" as const, color: "var(--c-text-muted)", margin: 0 }}>
                    Cook · {done.length}/{steps.length} steps
                  </p>
                  <span style={{ flex: 1, maxWidth: 160, height: 5, marginLeft: 12, background: "var(--c-surface-2)", borderRadius: 4, overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${steps.length ? (done.length / steps.length) * 100 : 0}%`, background: "var(--c-primary)", transition: "width .2s" }} />
                  </span>
                </div>
                {done.length === 0 && (
                  <p style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", color: "var(--c-text-muted)", margin: "-4px 0 var(--space-3)" }}>
                    Tap a step to mark your place as you cook
                  </p>
                )}
                <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "var(--space-2)" }}>
                  {steps.map((step: string, i: number) => {
                    const isDone = done.includes(i);
                    const isCurrent = i === currentStep;
                    return (
                      <li key={i}>
                        <button onClick={() => setProgress({ done: isDone ? done.filter((x) => x !== i) : [...done, i] })}
                          style={{ width: "100%", textAlign: "left" as const, cursor: "pointer", display: "flex", gap: "var(--space-3)", alignItems: "flex-start", padding: "var(--space-3) var(--space-4)", borderRadius: "var(--radius-md)", border: `1px solid ${isCurrent ? "var(--c-primary)" : "var(--c-border)"}`, background: isCurrent ? "var(--c-primary-tint)" : isDone ? "transparent" : "var(--c-surface)", boxShadow: isCurrent ? "var(--elev-1)" : "none", transition: "background .15s, border-color .15s" }}>
                          <span style={{ flexShrink: 0, width: 28, height: 28, borderRadius: "var(--radius-pill)", background: isDone || isCurrent ? "var(--c-primary)" : "var(--c-surface-2)", color: isDone || isCurrent ? "var(--c-on-primary)" : "var(--c-text-muted)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13, fontFamily: "var(--font-sans)" }}>
                            {isDone ? <Check size={15} strokeWidth={2.6} /> : i + 1}
                          </span>
                          <span style={{ paddingTop: 3, fontFamily: "var(--font-sans)", fontSize: isMobile ? "var(--t-body-size)" : "var(--t-bodylg-size)", lineHeight: isMobile ? "var(--t-body-lh)" : "var(--t-bodylg-lh)", color: isDone ? "var(--c-text-muted)" : "var(--c-text)", textDecoration: isDone ? "line-through" : "none", textDecorationColor: "var(--c-border)" }}>
                            {step}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          </div>

          {/* ── FOOTER ── */}
          {!made ? (
            <div style={{ ...footerBase, display: "flex", gap: "var(--space-3)" }}>
              <button onClick={() => setProgress({ made: true })} className={allDone ? "btn-primary btn--block" : "btn-secondary btn--block"} style={{ flex: 1 }}>
                <Check size={17} strokeWidth={2.4} />{allDone ? "Made it — log dinner" : "Mark as made"}
              </button>
              {nextCookable && (
                <button onClick={() => setActiveDate(nextCookable.date)} className="btn-ghost" style={{ flexShrink: 0 }}>
                  Next day <ChevronRight size={16} strokeWidth={2.2} />
                </button>
              )}
            </div>
          ) : (
            <div style={{ ...footerBase, display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <span style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--c-success-bg)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <Check size={19} color="var(--c-success-text)" strokeWidth={2.6} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontFamily: "var(--font-sans)", fontWeight: 600, fontSize: "var(--t-h3-size)", lineHeight: "var(--t-h3-lh)", color: "var(--c-text)", margin: 0 }}>
                    Logged for {weekdayLabel(activeDate)}
                  </p>
                  <p style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-bodysm-size)", color: "var(--c-text-muted)", margin: 0 }}>
                    {stars ? "Thanks — that helps us tune next week." : "How was it? Rate it so we learn your taste."}
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" as const }}>
                <div style={{ display: "flex", gap: 4 }} onMouseLeave={() => setHoverStar(0)}>
                  {[1, 2, 3, 4, 5].map((n) => {
                    const on = (hoverStar || stars) >= n;
                    return (
                      <button key={n} onClick={() => onRate(n)} onMouseEnter={() => setHoverStar(n)}
                        aria-label={`${n} star${n > 1 ? "s" : ""}`}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 2, lineHeight: 0 }}>
                        <Star size={28} fill={on ? "var(--c-accent)" : "none"} color={on ? "var(--c-accent)" : "var(--c-border)"} strokeWidth={1.6} />
                      </button>
                    );
                  })}
                </div>
                {stars > 0 && (
                  <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-bodysm-size)", color: "var(--c-primary)", fontWeight: 700 }}>
                    {stars >= 4 ? "More like this →" : stars === 3 ? "Noted — it was fine" : "We'll show it less ↓"}
                  </span>
                )}
              </div>
              {nextCookable && (
                <button onClick={() => setActiveDate(nextCookable.date)} className="btn-primary btn--block">
                  On to {weekdayLabel(nextCookable.date)} <ChevronRight size={16} strokeWidth={2.2} />
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ChipManager({ items, onRemove, empty, tone }: any) {
  if (!items.length) return <p style={{ ...s.empty, marginTop: 8 }}>{empty}</p>;
  return (
    <div style={{ ...s.tagWrap, marginTop: 10 }}>
      {items.map((x: string, i: number) => (
        <span key={i} style={{ ...s.tag, ...(tone === "red" ? { background: "var(--c-danger-bg)", color: "var(--c-danger)" } : {}), display: "inline-flex", gap: 5, alignItems: "center" }}>
          {x}<button onClick={() => onRemove(x)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "grid" }}><X size={12} /></button>
        </span>
      ))}
    </div>
  );
}

/* ============================ Receipt ingestion (TER-186) ============================ */

function buildReceiptParsePrompt(receiptText: string): string {
  return `You are parsing an ALDI grocery order confirmation or receipt.

Extract every line item and the order/receipt date. Rules:
- For substitutions: record what was ACTUALLY DELIVERED (the substitute), not the original request.
- Refunded, unavailable, or not-charged items: include them with "isRefund": true.
- Skip line items for fees, taxes, tips, delivery charges, and order totals.
- "2 x $1.99" means qty=2 and unitPriceCents=199.
- Sizes in parentheses: "Baker's Corner Brown Sugar (32 oz)" → packageSize="32 oz".
- Category headers (PRODUCE, DAIRY, etc.) label sections but are not items.

For each line item:
{
  "normalizedName": "lowercase generic name, e.g. \\"brown sugar\\", \\"boneless chicken breast\\"",
  "productName": "full product name as printed",
  "brand": "brand if identifiable, else null",
  "category": "one of: Produce, Meat & Seafood, Dairy & Eggs, Pantry, Frozen, Bakery, Other",
  "packageSize": "e.g. \\"32 oz\\", \\"1 lb\\", \\"12 ct\\", or null",
  "qty": 1,
  "unitPriceCents": price per single unit in cents as integer,
  "upc": null,
  "isRefund": false
}

Receipt text:
---
${receiptText.trim()}
---

Respond with ONLY a JSON object (no markdown, no fences, no commentary) in this exact shape:
{
  "orderDate": "YYYY-MM-DD",
  "items": [ ...array of line items as above... ]
}
Use null for orderDate if the receipt does not contain a date.`;
}

type ParsedRow = {
  normalizedName: string;
  productName: string;
  brand: string | null;
  category: string | null;
  packageSize: string | null;
  qty: number;
  unitPriceCents: number | null;
  upc: string | null;
  isRefund: boolean;
  include: boolean;
};

function IngestView({ session }: { session: any }) {
  const isMobile = useIsMobile();
  const [step, setStep] = useState<"paste" | "parsing" | "review" | "submitting" | "done">("paste");
  const [receiptText, setReceiptText] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [orderDate, setOrderDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState<{ submissionId: string; itemsCount: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const parseReceipt = async () => {
    if (!receiptText.trim()) return;
    setStep("parsing");
    setErr(null);
    const token = session?.access_token ?? "";
    try {
      const r = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          prompt: buildReceiptParsePrompt(receiptText),
          max_tokens: 4000,
          model: "claude-haiku-4-5-20251001",
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error?.message ?? `API error ${r.status}`);
      const text = (data.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("")
        .trim();
      const parsed = JSON.parse(text.replace(/```json/gi, "").replace(/```/g, "").trim());
      // Support both the new { orderDate, items } shape and a bare array (fallback).
      const itemsArr: any[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.items)
          ? parsed.items
          : (() => { throw new Error("Parser returned unexpected shape"); })();
      const parsedOrderDate = typeof parsed?.orderDate === "string" ? parsed.orderDate.trim() : "";
      setOrderDate(parsedOrderDate || new Date().toISOString().slice(0, 10));
      setRows(
        itemsArr.map((row: any) => ({
          normalizedName: String(row.normalizedName ?? "").trim(),
          productName: String(row.productName ?? "").trim(),
          brand: row.brand ?? null,
          category: CATEGORIES.includes(row.category) ? row.category : "Other",
          packageSize: row.packageSize ?? null,
          qty: Math.max(1, Math.round(Number(row.qty) || 1)),
          unitPriceCents: typeof row.unitPriceCents === "number" ? Math.round(row.unitPriceCents) : null,
          upc: row.upc ?? null,
          isRefund: !!row.isRefund,
          include: !row.isRefund,
        })),
      );
      setStep("review");
    } catch (e: any) {
      setErr(e?.message ?? "Parse failed — check the receipt text and try again.");
      setStep("paste");
    }
  };

  const submitIngest = async () => {
    setStep("submitting");
    setErr(null);
    const token = session?.access_token ?? "";
    try {
      const r = await fetch("/api/ingest-order", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ rows, orderDate: orderDate || null }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `API error ${r.status}`);
      setResult({ submissionId: data.submissionId, itemsCount: data.itemsCount });
      setStep("done");
    } catch (e: any) {
      setErr(e?.message ?? "Submission failed — try again.");
      setStep("review");
    }
  };

  const patchRow = (i: number, patch: Partial<ParsedRow>) =>
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const deliveredCount = rows.filter((r) => !r.isRefund && r.include).length;

  if (step === "done" && result) {
    return (
      <div style={s.card}>
        <h3 style={s.cardTitle}>Submitted for review</h3>
        <p style={{ fontSize: 14, color: "var(--c-text-muted)", marginTop: 8 }}>
          {result.itemsCount} item{result.itemsCount !== 1 ? "s" : ""} submitted for review. An admin will
          approve before the shared catalog updates. Your own purchase history was recorded immediately.
        </p>
        <button
          onClick={() => { setStep("paste"); setReceiptText(""); setRows([]); setResult(null); setOrderDate(new Date().toISOString().slice(0, 10)); }}
          style={{ ...s.ghostBtn, marginTop: 14 }}
        >
          Log another receipt
        </button>
      </div>
    );
  }

  if (step === "review" || step === "submitting") {
    return (
      <div style={{ display: "grid", gap: 14 }}>
        <div style={s.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h3 style={s.cardTitle}>Review parsed items</h3>
            <span style={s.miniLabel}>{deliveredCount} of {rows.length} included</span>
          </div>
          <p style={s.cardSub}>Uncheck refunds or mis-parses. Edit names if needed.</p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
            <label style={{ fontSize: 13, color: "var(--c-text-muted)", fontWeight: 600, whiteSpace: "nowrap" as const }}>Order date:</label>
            <input
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              style={{ ...s.input, width: 150, fontSize: 13 }}
            />
          </div>
          <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
            {rows.map((row, i) => (
              <div key={i} style={{ ...s.dayBlock, opacity: !row.include ? 0.55 : 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={row.include}
                    onChange={(e) => patchRow(i, { include: e.target.checked })}
                    style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, display: "grid", gap: 5 }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, alignItems: "center" }}>
                      {row.isRefund && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--c-danger)", background: "var(--c-danger-bg)", padding: "1px 7px", borderRadius: 10 }}>
                          REFUND
                        </span>
                      )}
                      <input
                        value={row.normalizedName}
                        onChange={(e) => patchRow(i, { normalizedName: e.target.value })}
                        placeholder="normalized name"
                        style={{ ...s.input, flex: 1, minWidth: isMobile ? 0 : 120, fontSize: 12.5 }}
                      />
                      <input
                        value={row.packageSize ?? ""}
                        onChange={(e) => patchRow(i, { packageSize: e.target.value || null })}
                        placeholder="size"
                        style={{ ...s.input, width: 70, fontSize: 12 }}
                      />
                      <input
                        type="number"
                        value={row.qty}
                        min={1}
                        onChange={(e) => patchRow(i, { qty: Math.max(1, Number(e.target.value) || 1) })}
                        style={{ ...s.input, width: 44, textAlign: "center", fontSize: 12 }}
                      />
                      {row.unitPriceCents != null && (
                        <span style={{ fontSize: 11, color: "var(--c-text-muted)", whiteSpace: "nowrap" as const }}>
                          ${(row.unitPriceCents / 100).toFixed(2)}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 11.5, color: "var(--c-text-muted)" }}>{row.productName}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        {err && (
          <p style={{ color: "var(--c-danger)", fontSize: 13, display: "flex", gap: 5, alignItems: "center" }}>
            <AlertCircle size={14} /> {err}
          </p>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={submitIngest}
            disabled={step === "submitting" || deliveredCount === 0}
            style={{ ...s.primaryBtn, opacity: step === "submitting" || deliveredCount === 0 ? 0.5 : 1 }}
          >
            {step === "submitting"
              ? <><RefreshCw size={15} className="spin" /> Saving…</>
              : <><Check size={15} /> Log {deliveredCount} item{deliveredCount !== 1 ? "s" : ""} to catalog</>}
          </button>
          <button onClick={() => setStep("paste")} disabled={step === "submitting"} style={s.ghostBtn}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={s.card}>
        <h3 style={s.cardTitle}>Log a receipt</h3>
        <p style={{ ...s.cardSub, marginTop: 4 }}>
          Paste your ALDI order confirmation or receipt. Claude extracts each item; you review before it's logged to the shared catalog.
        </p>
        <textarea
          value={receiptText}
          onChange={(e) => setReceiptText(e.target.value)}
          placeholder={"Paste ALDI receipt or order confirmation text here…\n\nExample:\nPRODUCE\nOrganic Bananas (3 lb)  $1.89\n\nMEAT\nBoneless Chicken Breasts (2.5 lb)  2 x $4.99\n\nREFUNDED\nSimply Nature Almond Milk — not available"}
          rows={14}
          style={{
            ...s.input,
            width: "100%",
            marginTop: 12,
            resize: "vertical",
            fontFamily: "monospace",
            fontSize: 12.5,
            lineHeight: 1.5,
            boxSizing: "border-box",
          } as any}
        />
        {err && (
          <p style={{ color: "var(--c-danger)", fontSize: 13, marginTop: 8, display: "flex", gap: 5, alignItems: "center" }}>
            <AlertCircle size={14} /> {err}
          </p>
        )}
      </div>
      <button
        onClick={parseReceipt}
        disabled={!receiptText.trim() || step === "parsing"}
        style={{ ...s.primaryBtn, justifyContent: "center", opacity: !receiptText.trim() || step === "parsing" ? 0.5 : 1 }}
      >
        {step === "parsing"
          ? <><RefreshCw size={16} className="spin" /> Parsing receipt…</>
          : <><Sparkles size={16} /> Parse receipt</>}
      </button>
      <div style={{ background: "var(--c-surface-2)", border: "1px solid var(--c-border)", borderRadius: 12, padding: "12px 16px", fontSize: 12.5, color: "var(--c-text-muted)", lineHeight: 1.6 }}>
        <strong>What gets logged:</strong> delivered items upsert the shared ALDI catalog (product name, size, price) and log to your purchase history. Re-submitting the same receipt will re-increment counts.
      </div>
    </div>
  );
}

/* ============================ Catalog ============================ */
type CatalogItem = {
  id: string;
  product_name: string | null;
  normalized_product: string;
  package_size: string | null;
  category: string | null;
  upc: string | null;
  kcal_per_100g: number | null;
  serving_g: number | null;
  macros: { protein_g: number; fat_g: number; carbs_g: number } | null;
  fdc_id: string | null;
  nutrition_source: string | null;
  nutrition_retrieved_at: string | null;
  nutrition_stale: boolean | null;
};

type PendingSubmission = {
  id: string;
  submitter_email: string | null;
  order_date: string | null;
  rows: any[];
  status: string;
  created_at: string;
};

type PendingUser = {
  id: string;
  email: string | null;
  name: string | null;
  nearest_aldi: string | null;
  reason: string | null;
  requested_at: string;
};

type PendingRecipe = {
  id: number;
  name: string;
  cuisine: string | null;
  difficulty: number | null;
  servings: number | null;
  ingredients: any[];
  steps: any[];
  source: string;
  model: string | null;
  created_at: string;
};

const REJECT_CATEGORIES: { value: string; label: string }[] = [
  { value: "not_original", label: "Not original" },
  { value: "bad_instructions", label: "Bad instructions" },
  { value: "implausible_ingredients", label: "Implausible ingredients" },
  { value: "duplicate", label: "Duplicate" },
  { value: "unappetizing", label: "Unappetizing" },
  { value: "format_error", label: "Format error" },
  { value: "other", label: "Other" },
];

function CatalogView({ session }: { session: any }) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [manualVals, setManualVals] = useState({ kcal: "", serving_g: "", protein: "", fat: "", carbs: "" });
  const [savingManual, setSavingManual] = useState(false);

  // Pending submissions queue (admin only)
  const [submissions, setSubmissions] = useState<PendingSubmission[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [subRowsExpanded, setSubRowsExpanded] = useState<Record<string, boolean>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  // TER-238: pending user approvals queue
  const [pendingUsers, setPendingUsers] = useState<PendingUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [approvingUserId, setApprovingUserId] = useState<string | null>(null);

  // TER-357: pending recipe review queue
  const [pendingRecipes, setPendingRecipes] = useState<PendingRecipe[]>([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [recipeIdx, setRecipeIdx] = useState(0);
  const [reviewingRecipeId, setReviewingRecipeId] = useState<number | null>(null);
  const [rejectingRecipeId, setRejectingRecipeId] = useState<number | null>(null);
  const [rejectCategory, setRejectCategory] = useState("");
  const [rejectNote, setRejectNote] = useState("");

  // TER-358: seed library
  const [seedTargets, setSeedTargets] = useState("");
  const [seedCount, setSeedCount] = useState(5);
  const [seeding, setSeeding] = useState(false);
  const [seedLog, setSeedLog] = useState<Array<{ target: string; ok: boolean; reason?: string }>>([]);

  // TER-266: qualified users list
  const [qualifiedUsers, setQualifiedUsers] = useState<Array<{ qualification_number: number; qualified_at: string; email: string | null; name: string | null }>>([]);
  const [qualCounter, setQualCounter] = useState<number>(0);
  const [qualLoading, setQualLoading] = useState(false);

  // TER-355: admin-grant qualification
  const [grantEmail, setGrantEmail] = useState("");
  const [grantResult, setGrantResult] = useState<string | null>(null);
  const [granting, setGranting] = useState(false);

  useEffect(() => { loadItems(); loadSubmissions(); loadPendingUsers(); loadQualifiedUsers(); loadPendingRecipes(); }, []);

  const loadItems = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("catalog")
      .select("id, product_name, normalized_product, package_size, category, upc, kcal_per_100g, serving_g, macros, fdc_id, nutrition_source, nutrition_retrieved_at, nutrition_stale")
      .order("updated_at", { ascending: false })
      .limit(200);
    setLoading(false);
    if (data) setItems(data as CatalogItem[]);
  };

  const loadSubmissions = async () => {
    const token = session?.access_token ?? "";
    if (!token) return;
    setSubsLoading(true);
    try {
      const r = await fetch("/api/admin/list-submissions", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) { setSubsLoading(false); return; } // 401/403 = not admin, fail closed
      const data = await r.json();
      setSubmissions(data.submissions ?? []);
    } catch { /* ignore */ }
    setSubsLoading(false);
  };

  const loadPendingUsers = async () => {
    const token = session?.access_token ?? "";
    if (!token) return;
    setUsersLoading(true);
    try {
      const r = await fetch("/api/admin/list-pending-users", { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) { setUsersLoading(false); return; }
      const data = await r.json();
      setPendingUsers(data.users ?? []);
    } catch { /* ignore */ }
    setUsersLoading(false);
  };

  const loadQualifiedUsers = async () => {
    const token = session?.access_token ?? "";
    if (!token) return;
    setQualLoading(true);
    try {
      const r = await fetch("/api/admin/list-qualified", { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) { setQualLoading(false); return; }
      const data = await r.json();
      setQualifiedUsers(data.users ?? []);
      setQualCounter(data.counter ?? 0);
    } catch { /* ignore */ }
    setQualLoading(false);
  };

  const handleGrantQualification = async () => {
    const email = grantEmail.trim();
    if (!email) return;
    const token = session?.access_token ?? "";
    setGranting(true);
    setGrantResult(null);
    try {
      const r = await fetch("/api/admin/grant-qualification", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ email }),
      });
      const d = await r.json();
      if (!r.ok) {
        setGrantResult(d.error ?? `Error ${r.status}`);
      } else if (d.alreadyQualified) {
        setGrantResult(`Already qualified — #${d.number} of 50`);
      } else if (d.capReached) {
        setGrantResult("Cap reached (50 of 50)");
      } else {
        setGrantResult(`Qualified! #${d.number} of 50`);
        setGrantEmail("");
        await loadQualifiedUsers();
      }
    } catch (e: any) {
      setGrantResult(e?.message ?? "Unknown error");
    }
    setGranting(false);
  };

  const handleApproveUser = async (userId: string) => {
    if (!confirm("Approve this user? They'll get full app access immediately.")) return;
    const token = session?.access_token ?? "";
    setApprovingUserId(userId);
    try {
      const r = await fetch("/api/admin/approve-user", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      setPendingUsers(p => p.filter(u => u.id !== userId));
    } catch (e: any) {
      alert(`Approve failed: ${e?.message ?? "Unknown error"}`);
    }
    setApprovingUserId(null);
  };

  const handleRejectUser = async (userId: string, email: string | null) => {
    if (!confirm(`Reject and delete ${email ?? userId}? This cannot be undone.`)) return;
    const token = session?.access_token ?? "";
    setApprovingUserId(userId);
    try {
      const r = await fetch("/api/admin/reject-user", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      setPendingUsers(p => p.filter(u => u.id !== userId));
    } catch (e: any) {
      alert(`Reject failed: ${e?.message ?? "Unknown error"}`);
    }
    setApprovingUserId(null);
  };

  const loadPendingRecipes = async () => {
    const token = session?.access_token ?? "";
    if (!token) return;
    setRecipesLoading(true);
    try {
      const r = await fetch("/api/admin/list-pending-recipes?limit=50", { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) { setRecipesLoading(false); return; }
      const data = await r.json();
      setPendingRecipes(data.recipes ?? []);
      setRecipeIdx(0);
    } catch { /* ignore */ }
    setRecipesLoading(false);
  };

  const handleApproveRecipe = async (id: number) => {
    const token = session?.access_token ?? "";
    setReviewingRecipeId(id);
    try {
      const r = await fetch("/api/admin/review-recipe", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, decision: "approve" }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      setPendingRecipes(p => {
        const next = p.filter(rx => rx.id !== id);
        setRecipeIdx(i => Math.min(i, Math.max(0, next.length - 1)));
        return next;
      });
    } catch (e: any) {
      alert(`Approve failed: ${e?.message ?? "Unknown error"}`);
    }
    setReviewingRecipeId(null);
  };

  const handleRejectRecipe = async (id: number, category: string, note: string) => {
    if (!category) { alert("Select a rejection category first."); return; }
    const token = session?.access_token ?? "";
    setReviewingRecipeId(id);
    try {
      const r = await fetch("/api/admin/review-recipe", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, decision: "reject", category, reason: note || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      setRejectingRecipeId(null);
      setRejectCategory("");
      setRejectNote("");
      setPendingRecipes(p => {
        const next = p.filter(rx => rx.id !== id);
        setRecipeIdx(i => Math.min(i, Math.max(0, next.length - 1)));
        return next;
      });
    } catch (e: any) {
      alert(`Reject failed: ${e?.message ?? "Unknown error"}`);
    }
    setReviewingRecipeId(null);
  };

  const handleSeedLibrary = async () => {
    const token = session?.access_token ?? "";
    if (!token) return;
    const targets = seedTargets.split("\n").map(l => l.trim()).filter(Boolean).slice(0, seedCount);
    if (!targets.length) { alert("Enter at least one dish target (one per line)."); return; }
    setSeeding(true);
    setSeedLog([]);
    for (const target of targets) {
      let recipe: any = null;
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            recipe = await generateRecipeFromPrompt(buildSeedPrompt(target, 4), token);
            break;
          } catch (e: any) {
            const retryable = e?.truncated || e instanceof SyntaxError || e?.message === "bad shape";
            if (!retryable || attempt === 2) throw e;
          }
        }
        const vr = await fetch("/api/recipes", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify(recipe),
        });
        const vd = await vr.json();
        if (vr.status === 422) {
          setSeedLog(l => [...l, { target, ok: false, reason: `hard fail: ${vd.hardFailures?.[0] ?? ""}` }]);
        } else if (vr.ok && vd.saved === false) {
          setSeedLog(l => [...l, { target, ok: false, reason: `soft fail: ${vd.softFailures?.[0] ?? ""}` }]);
        } else if (!vr.ok) {
          setSeedLog(l => [...l, { target, ok: false, reason: `HTTP ${vr.status}` }]);
        } else {
          setSeedLog(l => [...l, { target, ok: true }]);
        }
      } catch (e: any) {
        setSeedLog(l => [...l, { target, ok: false, reason: e?.message ?? "error" }]);
      }
    }
    setSeeding(false);
    await loadPendingRecipes();
  };

  const handleApprove = async (subId: string) => {
    if (!confirm("Approve this submission? Its items will be written to the shared catalog.")) return;
    const token = session?.access_token ?? "";
    setReviewingId(subId);
    try {
      const r = await fetch("/api/admin/approve-submission", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ submissionId: subId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      setSubmissions(p => p.filter(s => s.id !== subId));
      await loadItems();
    } catch (e: any) {
      alert(`Approve failed: ${e?.message ?? "Unknown error"}`);
    }
    setReviewingId(null);
  };

  const handleReject = async (subId: string) => {
    const reason = prompt("Reject reason (optional):") ?? "";
    if (reason === null) return; // user hit Cancel
    const token = session?.access_token ?? "";
    setReviewingId(subId);
    try {
      const r = await fetch("/api/admin/reject-submission", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ submissionId: subId, reason }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`);
      setSubmissions(p => p.filter(s => s.id !== subId));
    } catch (e: any) {
      alert(`Reject failed: ${e?.message ?? "Unknown error"}`);
    }
    setReviewingId(null);
  };

  const handleExpand = (id: string, item: CatalogItem) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setManualVals({
      kcal: item.kcal_per_100g != null ? String(item.kcal_per_100g) : "",
      serving_g: item.serving_g != null ? String(item.serving_g) : "",
      protein: item.macros?.protein_g != null ? String(item.macros.protein_g) : "",
      fat: item.macros?.fat_g != null ? String(item.macros.fat_g) : "",
      carbs: item.macros?.carbs_g != null ? String(item.macros.carbs_g) : "",
    });
  };

  const fetchByUpc = async (item: CatalogItem) => {
    if (!item.upc) return;
    setFetchingId(item.id);
    const token = session?.access_token ?? "";
    try {
      const nutRes = await fetch("/api/nutrition", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ mode: "gtin", gtin: item.upc }),
      });
      const nutData = await nutRes.json();
      if (!nutRes.ok || !nutData.hit) {
        setStatusMsg(p => ({ ...p, [item.id]: { ok: false, msg: nutData.miss_reason ?? "Not found in FDC or Open Food Facts" } }));
        return;
      }
      const saveRes = await fetch("/api/catalog-nutrition", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ mode: "auto", catalogId: item.id, result: nutData }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.error || `Error ${saveRes.status}`);
      const srcLabel = nutData.source === "usda" ? "USDA FDC" : "Open Food Facts";
      setStatusMsg(p => ({ ...p, [item.id]: { ok: true, msg: `Saved from ${srcLabel} — ${Math.round(nutData.kcal_per_100g)} kcal/100g` } }));
      await loadItems();
    } catch (e: any) {
      setStatusMsg(p => ({ ...p, [item.id]: { ok: false, msg: e?.message || "Failed" } }));
    } finally {
      setFetchingId(null);
    }
  };

  const saveManual = async (item: CatalogItem) => {
    setSavingManual(true);
    const token = session?.access_token ?? "";
    const kcal = manualVals.kcal ? Number(manualVals.kcal) : null;
    const servG = manualVals.serving_g ? Number(manualVals.serving_g) : null;
    const protein = manualVals.protein ? Number(manualVals.protein) : null;
    const fat = manualVals.fat ? Number(manualVals.fat) : null;
    const carbs = manualVals.carbs ? Number(manualVals.carbs) : null;
    const macros = protein != null && fat != null && carbs != null
      ? { protein_g: protein, fat_g: fat, carbs_g: carbs }
      : null;
    try {
      const res = await fetch("/api/catalog-nutrition", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ mode: "manual", catalogId: item.id, kcal_per_100g: kcal, serving_g: servG, macros }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setStatusMsg(p => ({ ...p, [item.id]: { ok: true, msg: "Saved manually" } }));
      await loadItems();
    } catch (e: any) {
      setStatusMsg(p => ({ ...p, [item.id]: { ok: false, msg: e?.message || "Failed" } }));
    } finally {
      setSavingManual(false);
    }
  };

  const filtered = search.trim()
    ? items.filter(it => (it.product_name ?? it.normalized_product).toLowerCase().includes(search.toLowerCase()))
    : items;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {/* ── Qualified users (TER-355) ── */}
      <div style={{ ...s.card, borderColor: "var(--c-success-bg)", marginBottom: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ ...s.cardTitle, margin: 0, color: "var(--c-success-text)" }}>
            Qualified: {qualLoading ? "…" : `${qualCounter} / 50`}
          </h3>
          <button onClick={loadQualifiedUsers} style={s.ghostBtn} disabled={qualLoading}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
          <input
            type="email"
            placeholder="user@example.com"
            value={grantEmail}
            onChange={e => { setGrantEmail(e.target.value); setGrantResult(null); }}
            onKeyDown={e => { if (e.key === "Enter") handleGrantQualification(); }}
            style={{ flex: 1, fontSize: 13, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-text)" }}
          />
          <button onClick={handleGrantQualification} style={{ ...s.primaryBtn, opacity: granting || !grantEmail.trim() ? 0.5 : 1 }} disabled={granting || !grantEmail.trim()}>
            {granting ? "…" : "Mark qualified"}
          </button>
        </div>
        {grantResult && (
          <p style={{ fontSize: 12.5, color: "var(--c-text-muted)", margin: "0 0 8px" }}>{grantResult}</p>
        )}
        {!qualLoading && qualifiedUsers.length === 0 && (
          <p style={s.empty}>No qualified users yet.</p>
        )}
        {qualifiedUsers.map(u => (
          <div key={u.qualification_number} style={{ ...s.dayBlock, marginBottom: 6, padding: "8px 12px" }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: "var(--c-success-text)", marginRight: 8 }}>#{u.qualification_number}</span>
            <span style={{ fontSize: 13, color: "var(--c-text)" }}>{u.name ?? "—"}</span>
            <span style={{ fontSize: 12.5, color: "var(--c-text-muted)", margin: "0 8px" }}>{u.email ?? "—"}</span>
            <span style={{ fontSize: 11.5, color: "var(--c-text-muted)" }}>{new Date(u.qualified_at).toLocaleDateString()}</span>
          </div>
        ))}
      </div>
      {/* ── Pending user approvals (TER-238) ── */}
      {(usersLoading || pendingUsers.length > 0) && (
        <div style={{ ...s.card, borderColor: "var(--c-warning-bg)", marginBottom: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{ ...s.cardTitle, margin: 0, color: "var(--c-warning)" }}>
              Pending users ({usersLoading ? "…" : pendingUsers.length})
            </h3>
            <button onClick={loadPendingUsers} style={s.ghostBtn} disabled={usersLoading}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
          {!usersLoading && pendingUsers.length === 0 && (
            <p style={s.empty}>No pending users.</p>
          )}
          {pendingUsers.map(user => {
            const isBusy = approvingUserId === user.id;
            return (
              <div key={user.id} style={{ ...s.dayBlock, marginBottom: 8, padding: "10px 12px", borderColor: "var(--c-warning-bg)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" as const }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "var(--c-text)" }}>{user.name ?? "—"}</div>
                    <div style={{ fontSize: 12.5, color: "var(--c-text-muted)", marginTop: 1 }}>{user.email ?? "—"}</div>
                    {user.nearest_aldi && <div style={{ fontSize: 12, color: "var(--c-text-muted)", marginTop: 2 }}>📍 {user.nearest_aldi}</div>}
                    {user.reason && <div style={{ fontSize: 12, color: "var(--c-text-muted)", marginTop: 2, fontStyle: "italic" }}>"{user.reason}"</div>}
                    <div style={{ fontSize: 11, color: "var(--c-text-muted)", marginTop: 3 }}>
                      {new Date(user.requested_at).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                    <button
                      onClick={() => handleApproveUser(user.id)}
                      style={s.primaryBtn}
                      disabled={isBusy}
                    >
                      {isBusy ? "…" : "Approve"}
                    </button>
                    <button
                      onClick={() => handleRejectUser(user.id, user.email)}
                      style={s.iconBtn}
                      disabled={isBusy}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* ── Seed library (TER-358) ── */}
      <div style={{ ...s.card, borderColor: "var(--c-primary)", marginBottom: 4 }}>
        <h3 style={{ ...s.cardTitle, margin: "0 0 10px", color: "var(--c-primary)" }}>Seed library</h3>
        <label style={{ ...s.fieldLabel, marginBottom: 4 }}>Dish targets — one per line (e.g. "Italian – Tuscan white-bean skillet")</label>
        <textarea
          value={seedTargets}
          onChange={e => setSeedTargets(e.target.value)}
          rows={6}
          placeholder={"Italian – Tuscan white-bean and sausage skillet\nMexican – Chicken enchiladas verde\nAsian – Beef and broccoli stir-fry"}
          style={{ width: "100%", fontSize: 12.5, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--c-border)", background: "var(--c-surface-2)", color: "var(--c-text)", fontFamily: "monospace", boxSizing: "border-box" as const, resize: "vertical" as const }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <label style={{ fontSize: 13, color: "var(--c-text-muted)" }}>Generate up to</label>
          <input
            type="number" min={1} max={20} value={seedCount}
            onChange={e => setSeedCount(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
            style={{ width: 55, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--c-border)", fontSize: 13, background: "var(--c-surface)", color: "var(--c-text)" }}
          />
          <span style={{ fontSize: 13, color: "var(--c-text-muted)" }}>
            of {seedTargets.split("\n").filter(l => l.trim()).length} targets · servings=4 · lands pending
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
          <button
            onClick={handleSeedLibrary}
            style={s.primaryBtn}
            disabled={seeding || !seedTargets.trim()}
          >
            {seeding ? "Seeding…" : `Seed ${Math.min(seedCount, seedTargets.split("\n").filter(l => l.trim()).length || 0)} recipe(s)`}
          </button>
          {seedLog.length > 0 && !seeding && (
            <span style={{ fontSize: 12.5, color: "var(--c-text-muted)" }}>
              {seedLog.filter(r => r.ok).length} saved · {seedLog.filter(r => !r.ok).length} skipped/failed
            </span>
          )}
        </div>
        {seedLog.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {seedLog.map((r, i) => (
              <div key={i} style={{ fontSize: 12, color: r.ok ? "var(--c-primary)" : "var(--c-text-muted)", padding: "2px 0", display: "flex", gap: 6 }}>
                <span style={{ fontWeight: 700 }}>{r.ok ? "✓" : "✗"}</span>
                <span>{r.target}{r.reason ? ` — ${r.reason}` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* ── Pending recipes (TER-357) ── */}
      {(recipesLoading || pendingRecipes.length > 0) && (() => {
        const recipe = pendingRecipes[recipeIdx];
        const isBusy = recipe != null && reviewingRecipeId === recipe.id;
        const isRejecting = recipe != null && rejectingRecipeId === recipe.id;
        return (
          <div style={{ ...s.card, borderColor: "var(--c-info-bg, #bfdbfe)", marginBottom: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ ...s.cardTitle, margin: 0, color: "var(--c-info-text, #1e40af)" }}>
                Pending recipes ({recipesLoading ? "…" : pendingRecipes.length})
              </h3>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {pendingRecipes.length > 1 && (
                  <>
                    <button onClick={() => setRecipeIdx(i => Math.max(0, i - 1))} style={s.ghostBtn} disabled={recipeIdx === 0}>←</button>
                    <span style={{ fontSize: 12, color: "var(--c-text-muted)" }}>{recipeIdx + 1} / {pendingRecipes.length}</span>
                    <button onClick={() => setRecipeIdx(i => Math.min(pendingRecipes.length - 1, i + 1))} style={s.ghostBtn} disabled={recipeIdx === pendingRecipes.length - 1}>→</button>
                  </>
                )}
                <button onClick={loadPendingRecipes} style={s.ghostBtn} disabled={recipesLoading}><RefreshCw size={13} /> Refresh</button>
              </div>
            </div>
            {recipesLoading && <p style={s.empty}>Loading…</p>}
            {!recipesLoading && !recipe && <p style={s.empty}>No pending recipes.</p>}
            {recipe && (
              <div style={{ ...s.dayBlock, padding: "12px 14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" as const }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "var(--c-text)", marginBottom: 2 }}>{recipe.name}</div>
                    <div style={{ fontSize: 12, color: "var(--c-text-muted)", marginBottom: 6 }}>
                      {[recipe.cuisine, recipe.servings != null && `${recipe.servings} srv`, recipe.difficulty != null && `diff ${recipe.difficulty}`, recipe.model].filter(Boolean).join(" · ")}
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--c-text)", marginBottom: 4, fontWeight: 600 }}>Ingredients</div>
                    <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 12.5, color: "var(--c-text-muted)" }}>
                      {(recipe.ingredients ?? []).map((ing: any, i: number) => (
                        <li key={i}>{ing.qty != null ? `${ing.qty}${ing.unit ? " " + ing.unit : ""} ` : ""}{ing.name}</li>
                      ))}
                    </ul>
                    <div style={{ fontSize: 12.5, color: "var(--c-text)", marginBottom: 4, fontWeight: 600 }}>Steps</div>
                    <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--c-text-muted)" }}>
                      {(recipe.steps ?? []).map((step: any, i: number) => (
                        <li key={i} style={{ marginBottom: 3 }}>{String(step)}</li>
                      ))}
                    </ol>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" as const, gap: 6, flexShrink: 0, alignItems: "flex-end" }}>
                    <button onClick={() => handleApproveRecipe(recipe.id)} style={s.primaryBtn} disabled={isBusy}>
                      {isBusy && !isRejecting ? "…" : "Approve"}
                    </button>
                    <button
                      onClick={() => { setRejectingRecipeId(isRejecting ? null : recipe.id); setRejectCategory(""); setRejectNote(""); }}
                      style={s.iconBtn}
                      disabled={isBusy}
                    >
                      Reject
                    </button>
                  </div>
                </div>
                {isRejecting && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--c-border)" }}>
                    <div style={{ marginBottom: 8 }}>
                      <label style={{ fontSize: 12, color: "var(--c-text-muted)", display: "block", marginBottom: 4 }}>
                        Category <span style={{ color: "var(--c-danger, #ef4444)" }}>*</span>
                      </label>
                      <select
                        value={rejectCategory}
                        onChange={e => setRejectCategory(e.target.value)}
                        style={{ fontSize: 13, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-text)", width: "100%" }}
                      >
                        <option value="">— select —</option>
                        {REJECT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 12, color: "var(--c-text-muted)", display: "block", marginBottom: 4 }}>Note (optional)</label>
                      <textarea
                        value={rejectNote}
                        onChange={e => setRejectNote(e.target.value)}
                        rows={2}
                        style={{ fontSize: 13, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--c-border)", background: "var(--c-surface)", color: "var(--c-text)", width: "100%", resize: "vertical" as const, boxSizing: "border-box" as const }}
                        placeholder="Optional explanation…"
                      />
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => handleRejectRecipe(recipe.id, rejectCategory, rejectNote)}
                        style={{ ...s.iconBtn, opacity: !rejectCategory || isBusy ? 0.5 : 1 }}
                        disabled={!rejectCategory || isBusy}
                      >
                        {isBusy ? "…" : "Confirm reject"}
                      </button>
                      <button onClick={() => setRejectingRecipeId(null)} style={s.ghostBtn} disabled={isBusy}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}
      {/* ── Pending submissions (admin review queue) ── */}
      {(subsLoading || submissions.length > 0) && (
        <div style={{ ...s.card, borderColor: "var(--c-border)", marginBottom: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{ ...s.cardTitle, margin: 0 }}>
              Pending submissions ({subsLoading ? "…" : submissions.length})
            </h3>
            <button onClick={loadSubmissions} style={s.ghostBtn} disabled={subsLoading}>
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
          {!subsLoading && submissions.length === 0 && (
            <p style={s.empty}>No pending submissions.</p>
          )}
          {submissions.map(sub => {
            const rowsVisible = subRowsExpanded[sub.id] ?? false;
            const isBusy = reviewingId === sub.id;
            return (
              <div key={sub.id} style={{ ...s.dayBlock, marginBottom: 8, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" as const }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: "var(--c-text)" }}>
                      {sub.submitter_email ?? "unknown"}
                    </span>
                    <span style={s.miniLabel as any}>
                      {sub.order_date ?? "no date"} · {Array.isArray(sub.rows) ? sub.rows.length : 0} items
                    </span>
                    <div style={{ fontSize: 11, color: "var(--c-text-muted)", marginTop: 2 }}>
                      {new Date(sub.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                    <button
                      onClick={() => setSubRowsExpanded(p => ({ ...p, [sub.id]: !rowsVisible }))}
                      style={s.ghostBtn}
                      disabled={isBusy}
                    >
                      {rowsVisible ? "Hide" : "View"}
                    </button>
                    <button
                      onClick={() => handleApprove(sub.id)}
                      style={s.primaryBtn}
                      disabled={isBusy}
                    >
                      {isBusy ? "…" : "Approve"}
                    </button>
                    <button
                      onClick={() => handleReject(sub.id)}
                      style={s.iconBtn}
                      disabled={isBusy}
                    >
                      Reject
                    </button>
                  </div>
                </div>
                {rowsVisible && Array.isArray(sub.rows) && (
                  <div style={{ marginTop: 10, maxHeight: 220, overflowY: "auto" as const, fontSize: 12, color: "var(--c-text-muted)" }}>
                    {sub.rows.map((r: any, i: number) => (
                      <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid var(--c-border)" }}>
                        <span style={{ fontWeight: 600, color: "var(--c-text)" }}>{r.productName || r.normalizedProduct}</span>
                        {r.brand && <span> · {r.brand}</span>}
                        {r.category && <span> · {r.category}</span>}
                        {r.packageSize && <span> · {r.packageSize}</span>}
                        {r.unitPriceCents != null && <span> · ${(r.unitPriceCents / 100).toFixed(2)}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ ...s.cardTitle, margin: 0 }}>Catalog ({filtered.length}{filtered.length !== items.length ? ` of ${items.length}` : ""})</h3>
        <button onClick={loadItems} style={s.ghostBtn}><RefreshCw size={13} /> Refresh</button>
      </div>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search products…"
        style={{ ...s.input, width: "100%", boxSizing: "border-box" } as any}
      />
      {loading && <p style={s.empty}>Loading…</p>}
      {!loading && filtered.length === 0 && (
        <p style={s.empty}>No catalog items yet — log a receipt to populate.</p>
      )}
      {filtered.map(item => {
        const expanded = expandedId === item.id;
        const hasNutrition = item.kcal_per_100g != null;
        const displayName = item.product_name ?? item.normalized_product;
        const srcLabel = item.nutrition_source === "usda" ? "USDA" : item.nutrition_source === "off" ? "OFF" : item.nutrition_source === "manual" ? "Manual" : null;
        const msg = statusMsg[item.id];

        return (
          <div key={item.id} style={s.dayBlock}>
            <button onClick={() => handleExpand(item.id, item)} style={{ ...s.collapseBtn, padding: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5, color: "var(--c-text)" }}>{displayName}</span>
                  {item.package_size && <span style={{ fontSize: 12, color: "var(--c-text-muted)", marginLeft: 6 }}>{item.package_size}</span>}
                </div>
                <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
                  {item.upc && <span style={{ fontSize: 10, color: "var(--c-text-muted)" }}>UPC</span>}
                  {hasNutrition && srcLabel && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--c-primary)", background: "var(--c-surface-2)", padding: "1px 6px", borderRadius: 10 }}>{srcLabel}</span>
                  )}
                  {hasNutrition && (
                    <span style={{ fontSize: 11.5, color: "var(--c-text-muted)", fontWeight: 600 }}>{Math.round(item.kcal_per_100g!)} kcal</span>
                  )}
                </div>
              </div>
              <span style={{ marginLeft: 10, color: "var(--c-text-muted)", fontSize: 11 }}>{expanded ? "▲" : "▼"}</span>
            </button>

            {expanded && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--c-border)", paddingTop: 12, display: "grid", gap: 12 }}>
                {hasNutrition && (
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" as const, fontSize: 12.5, color: "var(--c-text-muted)", alignItems: "center" }}>
                    <span><strong>{Math.round(item.kcal_per_100g!)} kcal</strong>/100g</span>
                    {item.serving_g != null && <span>Serving: {item.serving_g}g</span>}
                    {item.macros && (
                      <>
                        <span>P: {item.macros.protein_g}g</span>
                        <span>F: {item.macros.fat_g}g</span>
                        <span>C: {item.macros.carbs_g}g</span>
                      </>
                    )}
                    {item.nutrition_retrieved_at && (
                      <span style={{ color: "var(--c-text-muted)" }}>{new Date(item.nutrition_retrieved_at).toLocaleDateString()}</span>
                    )}
                  </div>
                )}

                {item.upc && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                      onClick={() => fetchByUpc(item)}
                      disabled={fetchingId === item.id}
                      style={{ ...s.ghostBtn, opacity: fetchingId === item.id ? 0.5 : 1, fontSize: 12.5, padding: "6px 11px" }}
                    >
                      {fetchingId === item.id
                        ? <><RefreshCw size={13} className="spin" /> Fetching…</>
                        : <><Sparkles size={13} /> Fetch nutrition by UPC</>}
                    </button>
                    <span style={{ fontSize: 11, color: "var(--c-text-muted)", fontFamily: "monospace" }}>{item.upc}</span>
                  </div>
                )}

                {msg && (
                  <p style={{ fontSize: 12.5, color: msg.ok ? "var(--c-primary)" : "var(--c-danger)", margin: 0, display: "flex", gap: 5, alignItems: "center" }}>
                    {msg.ok ? <Check size={13} /> : <AlertCircle size={13} />} {msg.msg}
                  </p>
                )}

                <div style={{ display: "grid", gap: 8 }}>
                  <span style={s.fieldLabel}>Manual nutrition</span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                    {[
                      { label: "kcal/100g", key: "kcal" as const, w: 80 },
                      { label: "serving g", key: "serving_g" as const, w: 72 },
                      { label: "protein g", key: "protein" as const, w: 72 },
                      { label: "fat g", key: "fat" as const, w: 64 },
                      { label: "carbs g", key: "carbs" as const, w: 68 },
                    ].map(({ label, key, w }) => (
                      <div key={key}>
                        <label style={{ fontSize: 11, color: "var(--c-text-muted)", display: "block", marginBottom: 2 }}>{label}</label>
                        <input
                          type="number"
                          value={manualVals[key]}
                          onChange={e => setManualVals(p => ({ ...p, [key]: e.target.value }))}
                          style={{ ...s.input, width: w, fontSize: 12 }}
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => saveManual(item)}
                    disabled={savingManual || !manualVals.kcal}
                    style={{ ...s.ghostBtn, opacity: savingManual || !manualVals.kcal ? 0.5 : 1, fontSize: 12.5, width: "fit-content" }}
                  >
                    {savingManual ? <><RefreshCw size={13} className="spin" /> Saving…</> : <><Check size={13} /> Save manual</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ============================ bits + styles ============================ */
function KcalBadge({ kcalPerServing, tier }: { kcalPerServing: number | null; tier: string }) {
  const isEst = tier === "estimate";
  const isUSDA = tier === "usda";
  const label = tier === "catalog" ? "ALDI catalog" : tier === "usda" ? "USDA" : "Estimated";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8, flexWrap: "wrap" as const }}>
      {kcalPerServing !== null ? (
        <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--c-text)" }}>
          {isEst ? "~" : ""}{kcalPerServing} kcal/serving
        </span>
      ) : (
        <span style={{ fontSize: 13, color: "var(--c-warning)" }}>— kcal/serving</span>
      )}
      <span style={{
        fontSize: 10, fontWeight: 700,
        color: isEst ? "var(--c-warning)" : "var(--c-primary)",
        background: isEst ? "var(--c-warning-bg)" : "var(--c-surface-2)",
        padding: "1px 7px", borderRadius: 10,
      }}>{label}</span>
      {isUSDA && <span style={{ fontSize: 10, color: "var(--c-text-muted)" }}>{USDA_ATTRIBUTION}</span>}
    </div>
  );
}

function DifficultyBadge({ difficulty }: { difficulty: number }) {
  const pips = Array.from({ length: 5 }, (_, i) => i < difficulty ? "●" : "○").join("");
  const label = DIFFICULTY_LABELS[difficulty] ?? "";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6, flexWrap: "wrap" as const }}>
      <span style={{ fontSize: 13, color: "var(--c-text)" }}>
        Effort: <span style={{ letterSpacing: 2 }}>{pips}</span> ({difficulty}/5)
      </span>
      <span style={{ fontSize: 10, fontWeight: 700, color: "var(--c-pill-text)", background: "var(--c-accent)", padding: "1px 7px", borderRadius: 10 }}>
        {label}
      </span>
    </div>
  );
}

/* ============================ RecipeCard (TER-251) — standalone, no planner actions ============================ */
function RecipeCard({ meal, kcalInfo, onSaveRotation, onThumbUp, onThumbDown, isLiked }: { meal: any; kcalInfo?: { kcalPerServing: number | null; tier: string } | null; onSaveRotation?: () => void; onThumbUp?: () => void; onThumbDown?: () => void; isLiked?: boolean }) {
  const isMobile = useIsMobile();
  const totalMin = (meal.prepMinutes ?? 0) + (meal.cookMinutes ?? 0);
  const diffLabel = DIFFICULTY_LABELS[meal.difficulty] ?? "";

  const Ingredients = () => (
    <div>
      <p style={{ ...s.typeLabel, color: "var(--c-text-muted)", marginBottom: "var(--space-2)" }}>Ingredients</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-2)" }}>
        {(meal.ingredients ?? []).map((ing: any, i: number) => {
          const qty = fmtRecipeQty(ing);
          return (
            <li key={i} style={s.rcIngRow}>
              <span style={{ ...s.typeBody, color: "var(--c-text)" }}>
                {ing.name}{ing.staple && <span style={s.rcStaplePill}>staple</span>}
              </span>
              <span style={{ ...s.typeBodySm, color: "var(--c-text-muted)", textAlign: "right" as const, flexShrink: 0 }}>{qty}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );

  const Steps = () => (
    <div>
      <p style={{ ...s.typeLabel, color: "var(--c-text-muted)", marginBottom: "var(--space-2)" }}>Instructions</p>
      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "var(--space-3)" }}>
        {(meal.steps ?? []).map((step: string, i: number) => (
          <li key={i} style={s.rcStepRow}>
            <span style={s.rcStepMarker}>{i + 1}</span>
            <span style={{ ...s.typeBody, color: "var(--c-text)", paddingTop: 2 }}>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );

  return (
    <article style={{ ...s.rcCard, maxWidth: isMobile ? "none" : 680, margin: isMobile ? 0 : "0 auto" }}>
      {/* 1. Image slot — striped placeholder is the default state */}
      <div style={{ ...s.rcImgSlot, height: isMobile ? 190 : 240 }}>
        <span style={s.rcImgHint}>meal photo (optional)</span>
      </div>
      <div style={{ padding: "var(--space-5)" }}>
        {/* 2. Cuisine pill */}
        {meal.cuisine && <span style={s.rcCuisinePill}>{meal.cuisine}</span>}
        {/* 3. Meal name + description */}
        <h2 style={{ ...s.typeH2, color: "var(--c-text)", marginTop: meal.cuisine ? "var(--space-3)" : 0 }}>{meal.name}</h2>
        {meal.description && <p style={{ ...s.typeBodySm, color: "var(--c-text-muted)", marginTop: "var(--space-2)" }}>{meal.description}</p>}
        {/* 4. Meta row */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", marginTop: "var(--space-3)" }}>
          {totalMin > 0 && <span style={s.rcMetaItem}><Clock size={15} color="var(--c-primary)" />{totalMin} min</span>}
          {meal.servings && <span style={s.rcMetaItem}><Users size={15} color="var(--c-primary)" />Serves {meal.servings}</span>}
          {kcalInfo?.kcalPerServing != null && <span style={s.rcMetaItem}><Flame size={15} color="var(--c-primary)" />~{kcalInfo.kcalPerServing} kcal</span>}
        </div>
        {/* 5. Badges */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginTop: "var(--space-3)", alignItems: "center" }}>
          {kcalInfo?.kcalPerServing != null && (
            <span style={kcalInfo.tier === "estimate" ? s.rcKcalBadgeEst : s.rcKcalBadge}>
              {kcalInfo.tier === "usda" ? "USDA" : kcalInfo.tier === "catalog" ? "ALDI catalog" : "Estimated"} · {kcalInfo.kcalPerServing} kcal/serving
            </span>
          )}
          {meal.difficulty != null && (
            <span style={s.rcEffortBadge}>
              <span style={{ letterSpacing: 1 }}>{"●".repeat(meal.difficulty)}{"○".repeat(5 - meal.difficulty)}</span>{" "}{diffLabel}
            </span>
          )}
        </div>
        {meal.dietaryAvoid?.length > 0 && (
          <div style={{ ...s.reuseNote, marginTop: "var(--space-3)" }}>{dietaryDisclaimer(meal.dietaryAvoid)}</div>
        )}
        {/* 6. Divider */}
        <hr style={s.rcDivider} />
        {/* 7+8. Ingredients + Instructions */}
        {!isMobile ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: "var(--space-6)" }}>
            <Ingredients />
            <Steps />
          </div>
        ) : (
          <div style={{ display: "grid", gap: "var(--space-5)" }}>
            <Ingredients />
            <Steps />
          </div>
        )}
        {/* 9. Footer */}
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-5)", flexWrap: "wrap" }}>
          {onThumbUp && (
            <button
              onClick={onThumbUp}
              style={{ ...s.thumb, color: isLiked ? "var(--c-primary)" : "var(--c-text-muted)", borderColor: isLiked ? "var(--c-primary)" : "var(--c-border)" }}
              title="Like"
            ><ThumbsUp size={15} /></button>
          )}
          {onThumbDown && (
            <button
              onClick={onThumbDown}
              style={{ ...s.thumb, color: "var(--c-danger)", borderColor: "var(--c-danger-bg)" }}
              title="Dislike"
            ><ThumbsDown size={15} /></button>
          )}
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onSaveRotation}>
            <Star size={16} /> Save to Recipe Box
          </button>
          <button className="btn-ghost" aria-label="Print" onClick={() => window.print()} style={{ padding: "0 var(--space-4)" }}>
            <Printer size={16} />
          </button>
        </div>
      </div>
    </article>
  );
}

/* ============================ OrderHistoryView (TER-288) — past orders, read-only ============================ */
function OrderHistoryView({ session, onReprint }: { session: any; onReprint: (meals: Array<{ date: string; meal: { data: any } }>) => void }) {
  const isMobile = useIsMobile();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [selectedMealIdx, setSelectedMealIdx] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from("orders")
      .select("id, created_at, plan")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setFetchError(error.message);
        else setOrders(data ?? []);
        setLoading(false);
      });
  }, [session.user.id]);

  if (loading) return <div style={s.card}><p style={s.empty}>Loading order history…</p></div>;
  if (fetchError) return <div style={s.card}><p style={{ ...s.empty, color: "var(--c-danger)" }}>Error: {fetchError}</p></div>;
  if (orders.length === 0) return (
    <div style={s.card}>
      <p style={s.empty}>No past orders yet. Use "Mark ordered &amp; start next week" to archive a plan.</p>
    </div>
  );

  // Single meal RecipeCard detail
  if (selectedOrder && selectedMealIdx !== null) {
    const adaptedMeals = selectedOrder.plan.meals.map((m: any) => ({ date: m.date, meal: { data: m.mealData } }));
    const entry = adaptedMeals[selectedMealIdx];
    return (
      <div>
        <button className="btn-ghost btn--sm" style={{ marginBottom: 16 }} onClick={() => setSelectedMealIdx(null)}>← Back</button>
        <RecipeCard meal={entry.meal.data} />
      </div>
    );
  }

  // Order detail: meal list + grocery list
  if (selectedOrder) {
    const plan = selectedOrder.plan;
    const adaptedMeals: Array<{ date: string; meal: { data: any } }> = (plan.meals ?? []).map((m: any) => ({ date: m.date, meal: { data: m.mealData } }));
    const startLabel = plan.startDate ? weekdayLabel(plan.startDate) : "";
    const lastMealDate = plan.meals?.length > 0 ? plan.meals[plan.meals.length - 1].date : null;
    const endLabel = lastMealDate ? weekdayLabel(lastMealDate) : "";
    const dateRange = startLabel && endLabel ? `${startLabel} – ${endLabel}` : new Date(selectedOrder.created_at).toLocaleDateString();
    const groceryList: Record<string, any[]> = plan.groceryList ?? {};
    const totalGroceryItems = Object.values(groceryList).reduce((n: number, a: any[]) => n + a.length, 0);

    return (
      <div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" as const }}>
          <button className="btn-ghost btn--sm" onClick={() => setSelectedOrder(null)}>← Back</button>
          <span style={{ ...s.typeH2, flex: 1 }}>{dateRange}</span>
          {plan.location && <span style={{ ...s.typeBodySm, color: "var(--c-text-muted)" }}>{plan.location}</span>}
        </div>

        {/* Meal rows — tap to open RecipeCard */}
        <div style={{ display: "grid", gap: 10, marginBottom: 20 }}>
          {adaptedMeals.map((entry, i) => (
            <button
              key={i}
              onClick={() => setSelectedMealIdx(i)}
              style={{ ...s.tocSummary, background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 12, cursor: "pointer" }}
            >
              <div style={s.tocLeft}>
                <div style={s.tocDate}>{weekdayLabel(entry.date)}</div>
                <div style={s.tocMealName}>{entry.meal.data.name}</div>
                {entry.meal.data.cuisine && (
                  <div style={{ ...s.typeBodySm, color: "var(--c-text-muted)" }}>{entry.meal.data.cuisine}</div>
                )}
              </div>
              <Clock size={16} color="var(--c-text-muted)" />
            </button>
          ))}
        </div>

        {/* Print */}
        <div style={{ marginBottom: 24 }}>
          <button className="btn-secondary" onClick={() => onReprint(adaptedMeals)}>
            <Printer size={16} /> Print recipes
          </button>
        </div>

        {/* Grocery list — read-only */}
        {totalGroceryItems > 0 && (
          <div>
            <h2 style={{ ...s.typeH2, marginBottom: 14 }}>Grocery list</h2>
            <div style={{ display: "grid", gap: 12 }}>
              {CATEGORIES.map((cat) => {
                const items = groceryList[cat];
                if (!items?.length) return null;
                return (
                  <div key={cat} style={s.lvCatCard}>
                    <h3 style={s.lvCatTitle}>{cat}</h3>
                    {items.map((it: any, ii: number) => (
                      <div key={ii} style={{ ...s.lvRow, borderBottom: ii < items.length - 1 ? "1px solid var(--c-border)" : "none" }}>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={s.typeBody}>{it.name}</span>
                          <span style={{ ...s.typeBodySm, color: "var(--c-text-muted)" }}>
                            {" · "}{fmtPurchaseQty(it.qty, it.unit, it.isPurchaseStyle)}
                          </span>
                          {it.staple && <span style={s.lvStaple}>staple</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Order list
  return (
    <div>
      <h1 style={{ ...s.typeH1, marginBottom: 16 }}>Order History</h1>
      <div style={{ display: "grid", gap: 12 }}>
        {orders.map((order) => {
          const plan = order.plan;
          const mealNames: string[] = (plan.meals ?? []).map((m: any) => m.mealData?.name ?? "").filter(Boolean);
          const lastMealDate = plan.meals?.length > 0 ? plan.meals[plan.meals.length - 1].date : null;
          const startLabel = plan.startDate ? weekdayLabel(plan.startDate) : "";
          const endLabel = lastMealDate ? weekdayLabel(lastMealDate) : "";
          const dateRange = startLabel && endLabel ? `${startLabel} – ${endLabel}` : new Date(order.created_at).toLocaleDateString();
          return (
            <button
              key={order.id}
              onClick={() => setSelectedOrder(order)}
              style={{ ...s.card, textAlign: "left" as const, width: "100%", border: "1px solid var(--c-border)", cursor: "pointer", display: "block", background: "var(--c-surface)" }}
            >
              <div style={{ ...s.cardTitle, marginBottom: 6 }}>{dateRange}</div>
              {plan.location && <div style={{ ...s.cardSub, marginBottom: 8 }}>{plan.location}</div>}
              <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6 }}>
                {mealNames.slice(0, 5).map((name, i) => <span key={i} style={s.tag}>{name}</span>)}
                {mealNames.length > 5 && <span style={s.tag}>+{mealNames.length - 5} more</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DPlate({ size = 40 }: { size?: number }) {
  const dSize = size * 0.60;
  const dotSize = dSize * 0.20;
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.27, background: "var(--c-primary)", display: "grid", placeItems: "center", boxShadow: "0 2px 6px rgba(43,140,126,.3)", flexShrink: 0 }}>
      <span style={{ position: "relative", fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", fontWeight: 800, fontSize: dSize, color: "#fff", lineHeight: 1 }}>
        D
        <span style={{ position: "absolute", left: "57%", top: "53%", transform: "translate(-50%,-50%)", width: dotSize, height: dotSize, borderRadius: "50%", background: "var(--c-accent)" }} />
      </span>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: any) {
  return <button onClick={onClick} aria-label={label} style={{ ...s.tab, ...(active ? s.tabActive : {}) }}>{icon}<span className="tab-label">{label}</span></button>;
}

const fontImport = `@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
.spin{animation:sp 1s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
.print-only{display:none}/* hidden on screen; revealed only for print below */
@media print{
  html,body,#root{height:auto!important;overflow:visible!important;}
  .no-print{display:none!important}
  .print-only{display:block;background:none!important;padding:0!important;}
  .print-sheet{box-shadow:none!important;border:none!important;border-radius:0!important;padding:32px 40px!important;}
  .recipe-page{break-after:page;page-break-after:always;margin-bottom:0!important;}
  .recipe-page:last-child{break-after:auto;page-break-after:auto;}
}`;
const serif = "'Plus Jakarta Sans', system-ui, sans-serif";
const sans  = "'Plus Jakarta Sans', -apple-system, sans-serif";

const s: Record<string, any> = {
  shell: { fontFamily: "var(--font-sans)", background: "var(--c-bg)", minHeight: "100%", color: "var(--c-text)", padding: "var(--space-5)", maxWidth: 780, margin: "0 auto" },
  header: { marginBottom: 18 }, logoRow: { display: "flex", alignItems: "center", gap: 12 },
  betaBadge: { display: "inline-block", fontSize: 10.5, fontWeight: 600, color: "var(--c-text-muted)", background: "var(--c-surface-2)", border: "1px solid var(--c-border)", borderRadius: 10, padding: "2px 8px", marginTop: 4 },
  h1: { fontFamily: serif, fontSize: 23, fontWeight: 800, margin: 0, letterSpacing: "-.01em" },
  sub: { margin: "2px 0 0", fontSize: 12.5, color: "var(--c-text-muted)" },
  tabs: { display: "flex", gap: 5, marginBottom: 18, background: "var(--c-surface-2)", padding: 5, borderRadius: 12, overflowX: "auto", WebkitOverflowScrolling: "touch" },
  tab: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "9px 4px", border: "none", borderRadius: 9, background: "transparent", color: "var(--c-text-muted)", fontFamily: sans, fontWeight: 600, fontSize: 12, cursor: "pointer", flexShrink: 0 },
  tabActive: { background: "var(--c-surface)", color: "var(--c-primary)", fontWeight: 700, boxShadow: "0 1px 3px rgba(0,0,0,.08)" },
  planGroup: { display: "flex", flexDirection: "column", gap: 4, padding: "4px 6px 5px", border: "1px solid var(--c-border)", borderRadius: 12, background: "rgba(43,140,126,0.06)", flexShrink: 0 },
  planGroupActive: { borderColor: "var(--c-primary)" },
  planGroupLabel: { fontSize: 9, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--c-text-muted)", paddingLeft: 2 },
  main: { paddingBottom: 40 },
  card: { background: "var(--c-surface)", borderRadius: 13, padding: 16, border: "1px solid var(--c-border)" },
  cardTitle: { fontFamily: serif, fontSize: 16.5, fontWeight: 600, margin: 0 },
  cardSub: { fontSize: 12.5, color: "var(--c-text-muted)", margin: "2px 0 0", fontWeight: 400 },
  miniLabel: { fontSize: 11, color: "var(--c-text-muted)" },
  fieldLabel: { fontSize: 11, fontWeight: 700, color: "var(--c-text-muted)", textTransform: "uppercase", letterSpacing: ".04em", display: "block", marginBottom: 5 },
  slotRow: { display: "flex", gap: 6, alignItems: "center" },
  dayBlock: { background: "var(--c-surface-2)", border: "1px solid var(--c-border)", borderRadius: 10, padding: 11 },
  dayHeadRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  dayDate: { fontFamily: serif, fontSize: 14.5, fontWeight: 600, color: "var(--c-text)" },
  fxChip: { fontSize: 11.5, fontWeight: 600, color: "var(--c-text-muted)", background: "var(--c-surface-2)", borderRadius: 14, padding: "3px 10px" },
  fxChipMuted: { fontSize: 11.5, color: "var(--c-text-muted)", fontStyle: "italic" },
  toggleRow: { display: "flex", gap: 10, alignItems: "flex-start", background: "var(--c-surface-2)", border: "1px solid var(--c-border)", borderRadius: 12, padding: 13, fontSize: 13.5, cursor: "pointer", lineHeight: 1.45 },
  collapseBtn: { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "transparent", border: "none", cursor: "pointer", fontSize: 14, color: "var(--c-text)", fontFamily: sans },
  input: { padding: "9px 10px", border: "1px solid var(--c-border)", borderRadius: 8, fontFamily: sans, fontSize: 13, color: "var(--c-text)", boxSizing: "border-box", background: "var(--c-surface)" },
  addBtn: { display: "inline-flex", alignItems: "center", gap: 5, background: "var(--c-surface-2)", color: "var(--c-primary)", border: "1px solid var(--c-border)", borderRadius: 8, padding: "7px 12px", fontFamily: sans, fontWeight: 700, fontSize: 12.5, cursor: "pointer" },
  primaryBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "var(--space-2)", background: "var(--c-primary)", color: "var(--c-on-primary)", border: "none", borderRadius: "var(--radius-md)", padding: "0 var(--space-4)", minHeight: "var(--tap-min)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--t-body-size)", cursor: "pointer", boxShadow: "var(--elev-primary)" },
  ghostBtn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "var(--space-2)", background: "transparent", color: "var(--c-text-muted)", border: "1px solid var(--c-border)", borderRadius: "var(--radius-md)", padding: "0 var(--space-4)", minHeight: "var(--tap-min)", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--t-body-size)", cursor: "pointer" },
  iconBtn: { background: "transparent", border: "none", cursor: "pointer", padding: 5, borderRadius: 6, display: "grid", placeItems: "center" },
  signOutBtn: { background: "transparent", border: "1px solid var(--c-border)", borderRadius: 8, padding: 7, cursor: "pointer", color: "var(--c-text-muted)", display: "grid", placeItems: "center", flexShrink: 0 },
  mealCard: { background: "var(--c-surface)", borderRadius: 13, padding: 16, border: "1px solid var(--c-border)", overflow: "hidden" },
  mealTop: { marginBottom: 8 },
  slotTag: { fontSize: 11.5, fontWeight: 700, color: "var(--c-text-muted)", textTransform: "uppercase", letterSpacing: ".04em" },
  mealName: { fontFamily: serif, fontSize: 18, fontWeight: 600, margin: 0, color: "var(--c-text)" },
  mealDesc: { fontSize: 13.5, color: "var(--c-text-muted)", margin: "4px 0 0", lineHeight: 1.45 },
  cuisineTag: { display: "inline-block", fontSize: 10.5, fontWeight: 700, color: "var(--c-pill-text)", background: "var(--c-accent)", padding: "1px 7px", borderRadius: 10, marginRight: 4, textTransform: "uppercase", letterSpacing: ".03em" },
  acceptedPill: { display: "inline-flex", alignItems: "center", gap: 4, background: "var(--c-primary)", color: "var(--c-on-primary)", fontSize: 11.5, fontWeight: 700, padding: "4px 9px", borderRadius: 20, whiteSpace: "nowrap" },
  reuseNote: { display: "flex", alignItems: "center", gap: 6, background: "var(--c-warning-bg)", border: "1px solid var(--c-warning-bg)", color: "var(--c-warning)", fontSize: 12.5, padding: "7px 11px", borderRadius: 8, marginTop: 10 },
  tagWrap: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 11 },
  tag: { background: "var(--c-surface-2)", color: "var(--c-text-muted)", fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 20, overflowWrap: "break-word", maxWidth: "100%" },
  acceptBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "var(--c-primary)", color: "var(--c-on-primary)", border: "none", borderRadius: 8, padding: "8px 15px", fontFamily: sans, fontWeight: 700, fontSize: 13, cursor: "pointer" },
  rejectBtn: { display: "inline-flex", alignItems: "center", gap: 6, background: "var(--c-surface)", color: "var(--c-danger)", border: "1px solid var(--c-danger-bg)", borderRadius: 8, padding: "8px 14px", fontFamily: sans, fontWeight: 700, fontSize: 13, cursor: "pointer" },
  thumb: { display: "grid", placeItems: "center", width: 34, height: 34, background: "var(--c-surface)", border: "1px solid", borderRadius: 8, cursor: "pointer" },
  rotateBtn: { display: "inline-flex", alignItems: "center", gap: 5, background: "var(--c-warning-bg)", color: "var(--c-warning)", border: "1px solid var(--c-warning-bg)", borderRadius: 8, padding: "7px 11px", fontFamily: sans, fontWeight: 700, fontSize: 12.5, cursor: "pointer" },
  empty: { color: "var(--c-text-muted)", fontSize: 13.5, fontStyle: "italic", margin: 0 },
  listToolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 10 },
  catTitle: { fontFamily: serif, fontSize: 15, fontWeight: 600, margin: "0 0 8px", color: "var(--c-primary)", borderBottom: "1px solid var(--c-border)", paddingBottom: 6 },
  listItem: { display: "flex", alignItems: "center", gap: 10, padding: "5px 0", fontSize: 14 },
  check: { width: 20, height: 20, borderRadius: 6, border: "1.5px solid var(--c-border)", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 },
  qtyText: { color: "var(--c-text-muted)", fontSize: 12.5 },
  stapleDot: { marginLeft: 6, fontSize: 10, fontWeight: 700, color: "var(--c-warning)", background: "var(--c-warning-bg)", padding: "1px 6px", borderRadius: 10 },
  pantryBtn: { fontSize: 11, fontWeight: 700, border: "1px solid", borderRadius: 14, padding: "2px 9px", cursor: "pointer" },
  starBtn: { background: "transparent", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px", flexShrink: 0 },
  rotItem: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--c-surface-2)", border: "1px solid var(--c-border)", borderRadius: 9, padding: "10px 12px" },
  timeLine: { fontSize: 12, color: "var(--c-text-muted)", margin: "8px 0 0" },
  stepsList: { margin: "10px 0 0", paddingLeft: 20, display: "grid", gap: 4 },
  stepItem: { fontSize: 13, color: "var(--c-text)", lineHeight: 1.5 },
  // Foundation type steps — PR1 tokens; consumed by PR2–PR5
  typeDisplay: { fontFamily: "var(--font-serif)", fontSize: "var(--t-display-size)", lineHeight: "var(--t-display-lh)", fontWeight: 600, letterSpacing: "-0.015em", margin: 0 },
  typeH1:      { fontFamily: "var(--font-serif)", fontSize: "var(--t-h1-size)",      lineHeight: "var(--t-h1-lh)",      fontWeight: 600, letterSpacing: "-0.01em",  margin: 0 },
  typeH2:      { fontFamily: "var(--font-serif)", fontSize: "var(--t-h2-size)",      lineHeight: "var(--t-h2-lh)",      fontWeight: 600, letterSpacing: "-0.01em",  margin: 0 },
  typeH3:      { fontFamily: "var(--font-serif)", fontSize: "var(--t-h3-size)",      lineHeight: "var(--t-h3-lh)",      fontWeight: 600,                            margin: 0 },
  typeBodyLg:  { fontFamily: "var(--font-sans)",  fontSize: "var(--t-bodylg-size)",  lineHeight: "var(--t-bodylg-lh)",  fontWeight: 400,                            margin: 0 },
  typeBody:    { fontFamily: "var(--font-sans)",  fontSize: "var(--t-body-size)",    lineHeight: "var(--t-body-lh)",    fontWeight: 400,                            margin: 0 },
  typeBodySm:  { fontFamily: "var(--font-sans)",  fontSize: "var(--t-bodysm-size)",  lineHeight: "var(--t-bodysm-lh)",  fontWeight: 400,                            margin: 0 },
  typeLabel:   { fontFamily: "var(--font-sans)",  fontSize: "var(--t-label-size)",   lineHeight: "var(--t-label-lh)",   fontWeight: 700, letterSpacing: "var(--t-label-tracking)", textTransform: "uppercase", margin: 0 },
  typeCaption: { fontFamily: "var(--font-sans)",  fontSize: "var(--t-caption-size)", lineHeight: "var(--t-caption-lh)", fontWeight: 600,                            margin: 0 },
  // TER-251: standalone RecipeCard
  rcCard:        { background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--elev-1)", overflow: "hidden" },
  rcImgSlot:     { background: "var(--c-surface-2)", backgroundImage: "repeating-linear-gradient(135deg, rgba(43,140,126,.06) 0 10px, transparent 10px 20px)", display: "flex", alignItems: "center", justifyContent: "center", borderBottom: "1px solid var(--c-border)" },
  rcImgHint:     { fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", fontWeight: 600, color: "var(--c-text-muted)", background: "rgba(255,255,255,.65)", padding: "3px 10px", borderRadius: "var(--radius-pill)" },
  rcCuisinePill: { display: "inline-block", fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", fontWeight: 700, color: "var(--c-pill-text)", background: "var(--c-accent)", padding: "5px 10px", borderRadius: "var(--radius-pill)", textTransform: "uppercase" as const, letterSpacing: "0.05em" },
  rcMetaItem:    { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--c-text)", fontFamily: "var(--font-sans)", fontSize: "var(--t-bodysm-size)", lineHeight: "var(--t-bodysm-lh)" },
  rcKcalBadge:   { fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", fontWeight: 600, color: "var(--c-primary)", background: "var(--c-surface-2)", padding: "3px 10px", borderRadius: "var(--radius-pill)" },
  rcKcalBadgeEst:{ fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", fontWeight: 600, color: "var(--c-warning)", background: "var(--c-warning-bg)", padding: "3px 10px", borderRadius: "var(--radius-pill)" },
  rcEffortBadge: { fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", fontWeight: 600, color: "var(--c-pill-text)", background: "var(--c-accent)", padding: "3px 10px", borderRadius: "var(--radius-pill)" },
  rcDivider:     { border: "none", borderTop: "1px solid var(--c-border)", margin: "var(--space-4) 0" },
  rcIngRow:      { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--space-3)", borderBottom: "1px dashed var(--c-border)", paddingBottom: "var(--space-2)" },
  rcStaplePill:  { display: "inline-block", fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", fontWeight: 700, color: "var(--c-warning)", background: "var(--c-warning-bg)", padding: "2px 7px", borderRadius: "var(--radius-pill)", marginLeft: 6 },
  rcStepRow:     { display: "flex", gap: "var(--space-3)", alignItems: "flex-start" },
  rcStepMarker:  { flexShrink: 0, width: 26, height: 26, borderRadius: "var(--radius-pill)", background: "var(--c-primary-tint)", color: "var(--c-primary-hover)", display: "grid", placeItems: "center", fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: "var(--t-bodysm-size)" },
  // TER-252: ListView grocery list restyle
  lvSunken:   { background: "var(--c-surface-2)", border: "1px solid var(--c-border)", borderRadius: "var(--radius-md)", padding: "var(--space-3) var(--space-4)", marginBottom: "var(--space-4)" },
  lvAhChip:   { display: "inline-flex", alignItems: "center", gap: 5, background: "var(--c-primary)", color: "var(--c-on-primary)", fontFamily: "var(--font-sans)", fontSize: "var(--t-bodysm-size)", fontWeight: 600, padding: "3px 9px 3px 10px", borderRadius: "var(--radius-pill)" },
  lvCatCard:  { background: "var(--c-surface)", borderRadius: "var(--radius-lg)", padding: "var(--space-4)", boxShadow: "var(--elev-1)", border: "1px solid var(--c-border)" },
  lvCatTitle: { fontFamily: "var(--font-serif)", fontSize: 15, fontWeight: 600, margin: "0 0 var(--space-2)", color: "var(--c-primary)", borderBottom: "1px solid var(--c-border)", paddingBottom: "var(--space-2)" },
  lvRow:      { display: "flex", alignItems: "center", gap: "var(--space-3)", minHeight: "var(--tap-min)", padding: "var(--space-1) 0" },
  lvCheck:    { width: 24, height: 24, borderRadius: "var(--radius-sm)", border: "2px solid", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0, padding: 0, transition: "background 120ms, border-color 120ms" },
  lvHaveIt:   { fontFamily: "var(--font-sans)", fontSize: "var(--t-bodysm-size)", fontWeight: 700, border: "1px solid", borderRadius: "var(--radius-pill)", padding: "2px 9px", cursor: "pointer", whiteSpace: "nowrap" as const, display: "inline-flex", alignItems: "center", minHeight: 28 },
  lvStar:     { background: "transparent", border: "none", cursor: "pointer", padding: "0 2px", flexShrink: 0, display: "grid", placeItems: "center" },
  lvStaple:   { display: "inline-block", marginLeft: 6, fontFamily: "var(--font-sans)", fontSize: "var(--t-label-size)", fontWeight: 700, color: "var(--c-warning)", background: "var(--c-warning-bg)", padding: "2px 7px", borderRadius: "var(--radius-pill)" },
  lvFooter:   { marginTop: "var(--space-4)", padding: "var(--space-3) var(--space-4)", background: "var(--c-success-bg)", border: "1px solid var(--c-border)", borderRadius: "var(--radius-md)" },
  // TER-283: TOC wizard
  tocRow:        { background: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 12, overflow: "hidden" },
  tocRowActive:  { borderColor: "var(--c-primary)", boxShadow: "0 0 0 1px var(--c-primary)" },
  tocSummary:    { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" as const, gap: 12 },
  tocLeft:       { flex: 1, minWidth: 0, display: "grid", gap: 2 },
  tocDate:       { fontSize: 11, fontWeight: 700, color: "var(--c-text-muted)", textTransform: "uppercase" as const, letterSpacing: ".04em" },
  tocMealName:   { fontFamily: serif, fontSize: 15, fontWeight: 600, color: "var(--c-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const },
  tocDetail:     { padding: "12px 14px 14px", borderTop: "1px solid var(--c-border)" },
};
