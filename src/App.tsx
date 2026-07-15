import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Plus, X, Check, Copy, Sparkles, RefreshCw, Settings2,
  ListChecks, CheckCircle2, AlertCircle, Repeat, Info,
  ThumbsUp, ThumbsDown, Star, CalendarDays, LogOut,
  ReceiptText, HelpCircle, Clock, Users, Flame, Printer, ShoppingCart,
  MessageSquare, ChevronLeft, ChevronRight, Undo2, PackageCheck,
} from "lucide-react";
import { supabase } from "@terenc/shared/supabase";
import { normalizeIngName, mergePantryIntoAlwaysHave } from "./lib/normalize";
import { resolveNutrition, USDA_ATTRIBUTION, type NutritionResult } from "./lib/nutritionResolve";
import { buildInstacartHandoff } from "./lib/instacart-handoff";
import { repairWeek, stripBankedProvenance } from "./lib/ingredientFlow";
import { checkRecipe, avoidPromptBlock, mergeTerms } from "./lib/avoidGuard";
import { isValidEmail, sanitizeOtpCode, classifySendError, friendlySendError, friendlyVerifyError, OTP_LENGTH, RESEND_COOLDOWN_S } from "./lib/authHelpers";
import { addDays, shouldApplyRemoteState } from "@terenc/shared/weekState";
import { emptyDateModel, mergeWindowIntoDateModel, hydrateWindow, migrateLegacyBlob, type DateModel } from "@terenc/shared/dateModel";
import { listScopeFromModel, reuseScopeFromModel } from "./lib/listScope";
import { s, serif, sans } from "./lib/styles";
import { CATEGORIES, generateRecipeFromPrompt, recipeOutputContract } from "./lib/recipeGenerate.js";
import { isExcludedFromWeeklyList } from "./lib/shoppingExclusion";
import { uid, useIsMobile } from "./lib/utils";
import { fmtPurchaseQty, DIFFICULTY_LABELS, fmtRecipeQty, dietaryDisclaimer } from "./lib/format";
import ListView from "./components/ListView";
import RotationView from "./components/RotationView";
import RecipeImportHandler from "./components/RecipeImportHandler";
import SetupView from "./components/SetupView";
import ShareRecipeButton from "./components/ShareRecipeButton";

/* ------------------------------------------------------------------ */
/*  ALLDEEZMeals - ALDI family meal planner, weather-aware, learns      */
/*  Weather: Open-Meteo (free, keyless, direct).                        */
/*  Meal gen: POST /api/generate (serverless proxy holds the key).      */
/*  Storage: localStorage.                                              */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "alldeezmeals-v1";

export const EFFORT_LEVELS: { key: string; label: string; min: number; max: number }[] = [
  { key: "any",      label: "Any effort",             min: 0, max: 5 },
  { key: "easy",     label: "Easy (Premade–Minimal)", min: 0, max: 1 },
  { key: "simple",   label: "Simple or less",         min: 0, max: 2 },
  { key: "moderate", label: "Moderate",               min: 2, max: 3 },
  { key: "involved", label: "Involved+",              min: 4, max: 5 },
];

// TER-429 (M-8): no seeded location — the bundle must not ship anyone's coordinates,
// and weather must not fetch until the user has set a location.
type Location = { name: string; lat: number; lon: number };

const DEFAULT_STAPLES: any[] = [];

/* ---- date helpers ---- */
const isoToday = () => toISO(new Date());
function toISO(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function parseISO(s: string) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
export function weekdayLabel(iso: string) { return parseISO(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }

/* ---- WMO weather code -> label/emoji ---- */
export function wx(code: number) {
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
    // TER-401: common non-allergen restrictions the audit showed going unacknowledged
    ["pork",     ["pork"]],
    ["beef",     ["beef", "red meat"]],
    ["alcohol",  ["alcohol", "booze", "wine", "beer"]],
  ];
  return TERMS.filter(([, triggers]) => triggers.some(hasAvoid)).map(([canonical]) => canonical);
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
  const [qualificationNumber, setQualificationNumber] = useState<number | null>(null);
  const [approvedStatus, setApprovedStatus] = useState<boolean | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const prevUserId = useRef<string | null>(null);
  const hydrated = useRef(false); // true once this user's Supabase row has been fetched
  // TER-388: who/when wrote the localStorage blob we booted from, captured before any
  // re-save can re-stamp it. Used to decide whether the remote row may overwrite it.
  const bootStamp = useRef<{ savedAt: string | null; savedBy: string | null }>({ savedAt: null, savedBy: null });
  // TER-426 (Phase B): the date-keyed canonical model (every date ever planned),
  // now reactive state so views can read it. Views go through the `liveModel`
  // merge below, never this state directly — it lags the window by one commit.
  // mergeWindowIntoDateModel's reference bailout is what keeps the
  // state → liveModel → setDateModel cycle from looping.
  const [dateModel, setDateModel] = useState<DateModel>(emptyDateModel);
  // TER-418: which startDate/numDays the current days[]/meals window was built for.
  // When the live values diverge from this anchor, the window is re-hydrated from the
  // date model instead of letting meals ride along positionally.
  const windowAnchor = useRef<{ startDate: string; numDays: number } | null>(null);

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

  // TER-510: resolve the user's qualification status from the server. Admin
  // detection was removed with the admin console — the consumer deploy no longer
  // reads ADMIN_EMAILS or receives an isAdmin flag.
  useEffect(() => {
    if (!session?.access_token) { setQualificationNumber(null); return; }
    let cancelled = false;
    fetch("/api/me", { headers: { authorization: `Bearer ${session.access_token}` } })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: any) => { if (!cancelled) setQualificationNumber(d?.qualification_number ?? null); })
      .catch(() => { if (!cancelled) setQualificationNumber(null); });
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
  const VALID_TABS = ["today", "setup", "plan", "list", "rotation", "receipt"];
  const [tab, setTab] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("alldeezmeals-active-tab");
      if (saved && VALID_TABS.includes(saved)) return saved;
    } catch {}
    return "today";
  });
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // TER-348: persist active tab so refresh restores user's place.
  useEffect(() => { try { localStorage.setItem("alldeezmeals-active-tab", tab); } catch {} }, [tab]);

  const [location, setLocation] = useState<Location | null>(null);
  const [startDate, setStartDate] = useState(isoToday());
  const [numDays, setNumDays] = useState(7);
  const [days, setDays] = useState([1, 2, 3, 4, 5, 6, 7].map(() => makeDay()));
  const [forecast, setForecast] = useState<Record<string, any>>({});
  const [fxStatus, setFxStatus] = useState("idle");

  const [meals, setMeals] = useState<Record<string, any>>({});
  const [staples, setStaples] = useState(DEFAULT_STAPLES);
  // TER-330: `pantry` and `alwaysHave` collapsed onto one normalized key.
  // Legacy `pantry` blobs are still read on hydrate and forward-merged here.
  const [alwaysHave, setAlwaysHave] = useState<string[]>([]);
  // TER-532: week-level note, copy-down source only — never sent to generation itself.
  const [weekNote, setWeekNote] = useState<string>("");
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [weekAdditions, setWeekAdditions] = useState<Array<{id: string; name: string; qty: string; category?: string}>>([]);
  // TER-504: per-week "have it" override — items you already have for THIS trip.
  // Additive `user_state` key; excludes from the weekly buy like `alwaysHave` but
  // never writes the durable list, and clears only on Mark Purchased.
  const [weekHaveIt, setWeekHaveIt] = useState<string[]>([]);
  const [defaultPeople, setDefaultPeople] = useState(4);
  const [efficiency, setEfficiency] = useState(true);
  const [mixCuisines, setMixCuisines] = useState(true);
  const [busy, setBusy] = useState(false);

  const [rotation, setRotation] = useState<any[]>([]);
  const [liked, setLiked] = useState<string[]>([]);
  const [avoid, setAvoid] = useState<string[]>([]);
  // TER-401: structured week-level allergy/avoid TERMS (ingredients). Distinct
  // from `avoid` above, which is TER-317 novelty exclusions (dish NAMES).
  const [avoidTerms, setAvoidTerms] = useState<string[]>([]);
  const [recipeStars, setRecipeStars] = useState<Record<string, number>>({});
  const [cookProgress, setCookProgress] = useState<Record<string, { gathered: number[]; done: number[]; servings: number; made: boolean }>>({});
  // TER-422: session-only memory of the last "mark ordered" stamp set, powering the
  // "Unmark last order" undo in the list view. Deliberately not persisted. Keyed by
  // date (TER-426) since the scope can include dates outside the current window.
  const [lastOrder, setLastOrder] = useState<{ dates: string[]; orderedAt: string } | null>(null);
  // TER-503: session-scoped per-slot rejection memory. Keyed by day.id, holds
  // every dish rejected for that slot this session so a re-roll never cycles back
  // to an earlier-rejected dish. Deliberately NOT persisted — rejections are
  // momentary; a fresh plan/reload starts clean. Cleared per-slot on accept.
  const [rejectedBySlot, setRejectedBySlot] = useState<Record<string, string[]>>({});

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
          // TER-422: re-materializing a pinned meal must not lose its ordered stamp.
          const orderedAt = prev[day.id]?.orderedAt;
          next = { ...next, [day.id]: { status: "accepted", data: scaled, error: null, kcalInfo: null, pinned: true, ...(orderedAt ? { orderedAt } : {}) } };
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
        bootStamp.current = { savedAt: d.savedAt ?? null, savedBy: d.savedBy ?? null };
        setLocation(d.location ?? null);
        if (d.startDate) setStartDate(d.startDate); // TER-388: was saved but never restored
        setNumDays(d.numDays ?? 7);
        // TER-418: prefer the date model when present; migrate legacy blobs into it.
        const hasModel = d.mealsByDate && d.dayConfigByDate;
        const bootStart = d.startDate || isoToday();
        const bootNum = d.numDays ?? 7;
        setDateModel(hasModel
          ? { mealsByDate: d.mealsByDate, dayConfigByDate: d.dayConfigByDate }
          : migrateLegacyBlob(d));
        windowAnchor.current = { startDate: bootStart, numDays: bootNum };
        if (hasModel) {
          const w = hydrateWindow(d.mealsByDate, d.dayConfigByDate, bootStart, bootNum, () => makeDay(d.defaultPeople ?? 4));
          setDays(w.days);
          setMeals(w.meals);
        } else {
          setDays(d.days ?? days);
          setMeals(d.meals ?? {});
        }
        setForecast(d.forecast ?? {});
        setStaples(d.staples ?? DEFAULT_STAPLES);
        // TER-330: forward-merge legacy `pantry` into the unified `alwaysHave` key.
        setAlwaysHave(mergePantryIntoAlwaysHave(d.pantry, d.alwaysHave));
        setWeekNote(d.weekNote ?? "");
        setCheckedItems(d.checkedItems ?? {});
        if (d.weekAdditions) setWeekAdditions(d.weekAdditions);
        if (d.weekHaveIt) setWeekHaveIt(d.weekHaveIt); // TER-504
        setDefaultPeople(d.defaultPeople ?? 4);
        setEfficiency(d.efficiency ?? true);
        setMixCuisines(d.mixCuisines ?? true);
        setRotation(d.rotation ?? []);
        setLiked(d.liked ?? []);
        setAvoid(d.avoid ?? []);
        setAvoidTerms(d.avoidTerms ?? []);
        if (d.recipeStars) setRecipeStars(d.recipeStars);
        // TER-428: old blobs may still carry a `currentWeek` key — ignored.
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
      .select("state, updated_at")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) { console.warn("user_state fetch failed:", error.message); hydrated.current = true; return; }
        if (data?.state) {
          const d = data.state;
          // TER-388 (I-1): the remote row lags local saves by the 2 s debounce, so on a
          // reload it can be staler than what localStorage just restored. Only apply it
          // when it's newer; otherwise keep local and push it up so the row catches up.
          const remoteStamp = d.savedAt ?? data.updated_at ?? null;
          if (!shouldApplyRemoteState({ localSavedAt: bootStamp.current.savedAt, localSavedBy: bootStamp.current.savedBy, remoteStamp, userId })) {
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
                  .then(({ error: pushErr }) => { if (pushErr) console.warn("user_state push failed:", pushErr.message); });
              }
            } catch {}
            hydrated.current = true;
            return;
          }
          if (d.location !== undefined) setLocation(d.location);
          if (d.startDate !== undefined) setStartDate(d.startDate);
          if (d.numDays !== undefined) setNumDays(d.numDays);
          // TER-418: prefer the date model when present; migrate legacy payloads into it.
          const hasModel = d.mealsByDate && d.dayConfigByDate;
          const nextStart = d.startDate !== undefined ? d.startDate : startDate;
          const nextNum = d.numDays !== undefined ? d.numDays : numDays;
          setDateModel(hasModel
            ? { mealsByDate: d.mealsByDate, dayConfigByDate: d.dayConfigByDate }
            : migrateLegacyBlob(d));
          windowAnchor.current = { startDate: nextStart, numDays: nextNum };
          if (hasModel) {
            const w = hydrateWindow(d.mealsByDate, d.dayConfigByDate, nextStart, nextNum, () => makeDay(d.defaultPeople ?? 4));
            setDays(w.days);
            setMeals(w.meals);
          } else {
            if (d.days !== undefined) setDays(d.days);
            if (d.meals !== undefined) setMeals(d.meals);
          }
          if (d.forecast !== undefined) setForecast(d.forecast);
          if (d.staples !== undefined) setStaples(d.staples);
          // TER-330: forward-merge legacy `pantry` into the unified `alwaysHave` key.
          if (d.pantry !== undefined || d.alwaysHave !== undefined) setAlwaysHave(mergePantryIntoAlwaysHave(d.pantry, d.alwaysHave));
          if (d.weekNote !== undefined) setWeekNote(d.weekNote);
          if (d.checkedItems !== undefined) setCheckedItems(d.checkedItems);
          if (d.weekAdditions !== undefined) setWeekAdditions(d.weekAdditions);
          if (d.weekHaveIt !== undefined) setWeekHaveIt(d.weekHaveIt); // TER-504
          if (d.defaultPeople !== undefined) setDefaultPeople(d.defaultPeople);
          if (d.efficiency !== undefined) setEfficiency(d.efficiency);
          if (d.mixCuisines !== undefined) setMixCuisines(d.mixCuisines);
          if (d.rotation !== undefined) setRotation(d.rotation);
          if (d.liked !== undefined) setLiked(d.liked);
          if (d.avoid !== undefined) setAvoid(d.avoid);
          if (d.avoidTerms !== undefined) setAvoidTerms(d.avoidTerms);
          if (d.recipeStars !== undefined) setRecipeStars(d.recipeStars);
          // TER-428: old rows may still carry a `currentWeek` key — ignored.
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

  // TER-426: the persisted model overlaid with the current window, computed
  // in-render so views are never one render behind a just-accepted meal. While
  // the window is off its anchor (re-hydration pending in the sync effect
  // below), merging would mis-bind the old window's meals onto the new dates —
  // return the persisted model untouched for that one commit instead.
  const liveModel = useMemo(() => {
    if (!loaded) return dateModel;
    const anchor = windowAnchor.current;
    if (anchor && (anchor.startDate !== startDate || anchor.numDays !== numDays)) return dateModel;
    return mergeWindowIntoDateModel(dateModel, days, meals, startDate);
  }, [loaded, dateModel, days, meals, startDate, numDays]);

  // TER-418/TER-426: keep the date model and the runtime window in sync. Two cases:
  // (a) days/meals changed inside the current window → persist `liveModel` (the
  //     merged overlay). The merge's reference bailout makes this loop-safe:
  //     once the model has absorbed the window, liveModel === dateModel and the
  //     setState bails out of the re-render;
  // (b) startDate/numDays moved off the anchor → fold any not-yet-persisted window
  //     edits into the model under the OLD anchor, then re-hydrate days/meals for
  //     the new window so meals stay bound to their dates instead of riding along
  //     positionally. Moving the window off planned dates hides their meals
  //     (preserved in the model); moving it back restores them.
  useEffect(() => {
    if (!loaded) return;
    const anchor = windowAnchor.current;
    if (anchor && (anchor.startDate !== startDate || anchor.numDays !== numDays)) {
      const m = mergeWindowIntoDateModel(dateModel, days, meals, anchor.startDate);
      const w = hydrateWindow(m.mealsByDate, m.dayConfigByDate, startDate, numDays, () => makeDay(defaultPeople));
      windowAnchor.current = { startDate, numDays };
      if (m !== dateModel) setDateModel(m);
      setDays(w.days);
      setMeals(w.meals);
      return;
    }
    windowAnchor.current = { startDate, numDays };
    setDateModel(liveModel);
  }, [loaded, dateModel, liveModel, days, meals, startDate, numDays, defaultPeople]);

  // 3. Save to localStorage immediately and to Supabase (debounced 2 s) on every change.
  //    localStorage acts as offline cache; Supabase is the authoritative cross-device store.
  useEffect(() => {
    if (!loaded) return;
    const payload = {
      // TER-388: stamp every save so the load path can tell which copy is newer.
      // Pre-auth boot re-saves keep the boot blob's owner — the UI is auth-gated, so
      // no edits can happen signed-out, and clobbering savedBy with null would let a
      // stale remote win on the next reload.
      savedAt: new Date().toISOString(), savedBy: session?.user?.id ?? bootStamp.current.savedBy,
      // TER-330: `pantry` is no longer written — its entries are forward-merged
      // into `alwaysHave` on hydrate. Old clients still read `alwaysHave`, so the
      // merged set keeps excluding correctly with no data loss.
      location, startDate, numDays, days, forecast, meals, staples, alwaysHave, weekNote,
      checkedItems, weekAdditions, weekHaveIt, defaultPeople, efficiency, mixCuisines, rotation, liked, avoid, avoidTerms, recipeStars, cookProgress,
      // TER-418: dual-write the date-keyed canonical model alongside the legacy keys.
      // TER-428: `currentWeek` is gone from state and payload — the rollback floor
      // is now Phase B (TER-426); older builds rendered Today from currentWeek and
      // would lose it. Acceptable: the date model is the canonical store.
      // liveModel (not dateModel) so the payload always carries the current window.
      mealsByDate: liveModel.mealsByDate, dayConfigByDate: liveModel.dayConfigByDate,
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
  }, [location, startDate, numDays, days, forecast, meals, staples, alwaysHave, weekNote, checkedItems, weekAdditions, weekHaveIt, defaultPeople, efficiency, mixCuisines, rotation, liked, avoid, avoidTerms, recipeStars, cookProgress, liveModel, loaded, session]); // eslint-disable-line

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
    if (!location) return; // TER-429: no fetch until a location is set
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

  useEffect(() => { if (loaded && location) loadForecast(); }, [loaded, location, startDate, numDays]); // eslint-disable-line

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

  const buildPrompt = (day: any, dateISO: string, committed: any[], usedCuisines: string[], rejected: string[] = [], violatedTerms: string[] = [], weekAvoid: string[] = avoidTerms, dropNote = false) => {
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
    "reused" — from a pack already bought this week for another meal, OR batch-prepped earlier (e.g. chicken poached earlier this week, then shredded). recipeAmount required; set purchaseSize to "" and purchaseQty to 0. ALSO set buySourceName to the EXACT raw item name from "Dinners sharing this shopping trip" below for the meal that buys it (e.g. buySourceName:"boneless skinless chicken breasts") — it MUST match one of those listed buy-item names character-for-character so the shopping list aggregates this into that single raw purchase. Standardize batch-prep wording on "poached" (not "cooked").
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

    // TER-401: structured week-level avoid terms + per-day note-detected terms,
    // injected with severe-restriction framing into EVERY generation prompt.
    // weekAvoid is passed explicitly so a generation run kicked off in the same
    // event as an avoid-list commit uses the merged list, not stale state.
    const avoidBlock = avoidPromptBlock(weekAvoid, detectDietaryTerms(day.note ?? ""), violatedTerms);

    // TER-503 Fix A: multi-dimensional exclusion of EVERY dish rejected for this
    // slot this session — a new name for a substantively similar dish is not
    // acceptable; the proposal must differ on protein, cuisine, AND format.
    const rejectLine = rejected.length
      ? `\nThe user REJECTED these dinners for this slot — do NOT propose any of them again, and do NOT propose a near-variant of any: ${rejected.join("; ")}.\nYour proposal MUST differ from EVERY rejected dish above on ALL THREE of: main protein, cuisine, and dish format (e.g. stir-fry vs. bake vs. soup vs. tacos vs. salad). A renamed but similar dish is a failure.`
      : "";

    // TER-503 Fix B: on a re-roll (rejected.length > 0), variety wins over the
    // efficiency / ingredient-reuse bias. The efficiency block is kept verbatim
    // for the initial week plan (rejected.length === 0) — that's the cost value prop.
    const reshuffleOverride = rejected.length
      ? `\nVARIETY OVERRIDE (this is a re-roll, not the initial plan): prioritize a genuinely DIFFERENT meal over ingredient reuse and batch-prep efficiency. Ignore the default "batch chicken across multiple dinners" lean. Affordable, mainstream ALDI ingredients are still fine, but variety wins over reuse here.`
      : "";

    return `You are a practical weekly dinner planner for a family that shops at ALDI. Generate ONE dinner only (breakfast and lunch are covered by staples).

${wlabel}
People eating: ${day.people}
${tempGuide}
${cuisineGuide}
${effortGuide}
${day.note && !dropNote ? `Extra request: ${day.note}\nThe extra request above is a soft preference: if it is unclear, contradictory, or impossible to satisfy alongside the constraints above, use your best judgment and satisfy it as best you can. NEVER respond with anything other than the single required JSON object -- no apology, no explanation, no refusal, no prose.` : ""}
${avoidBlock}
${prefLines.join("\n")}

${eff}
- Do NOT repeat a main dish already planned below.${reshuffleOverride}
${rejectLine}

Dinners sharing this shopping trip (coordinate ingredient reuse with these and ONLY these):
${prior}

${recipeOutputContract(day.people)}`;
  };

  // TER-428: the cross-meal reuse context is the trip-sharing scope (unshopped,
  // today-forward, full model range), not the whole window — a dinner generated
  // after an order must not claim reuse from ingredients that already left with
  // the stamped trip. TER-400's scope repair remains the safety net.
  const committedData = (excludeDate?: string) => reuseScopeFromModel(liveModel, isoToday(), excludeDate);

  const usedCuisinesFrom = (data: any[]) => Array.from(new Set(data.map((m) => m.cuisine).filter(Boolean)));

  const generateOne = async (day: any, idx: number, committed: any[], rejected: string[] = [], weekAvoid: string[] = avoidTerms) => {
    setMeals((m) => ({ ...m, [day.id]: { status: "loading", data: null, error: null, kcalInfo: null } }));
    try {
      // TER-401: structured week-level avoid terms + per-day note-detected terms.
      const allAvoid = mergeTerms(weekAvoid, detectDietaryTerms(day.note ?? ""));
      const tok = session?.access_token ?? "";

      // Attempt library reuse when safe: authenticated, no dietary constraints
      // (per-day note OR week-level avoid list — TER-317/TER-401), not a pinned day.
      if (tok && allAvoid.length === 0 && !day.pinnedRecipe) {
        try {
          const lvl = EFFORT_LEVELS.find((l) => l.key === (day.effort ?? "any"));
          const effortMin = (lvl && lvl.key !== "any") ? lvl.min : null;
          const effortMax = (lvl && lvl.key !== "any") ? lvl.max : null;
          const excludeNames = [
            ...avoid,
            ...rotation.map((r: any) => r.name),
            ...committed.map((m: any) => m.name),
            ...rejected,
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
              // TER-400: banked recipes carry provenance/reuseNotes from their ORIGINAL week
              // (TER-317 serve-as-is) — strip week-specific claims before entering this week.
              const reusedData = stripBankedProvenance(rj.recipe);
              // TER-401 defense-in-depth: a served recipe that trips the avoid guard
              // falls through to fresh generation (unreachable while the gate above
              // requires an empty avoid list, but guards any future gate change).
              if (checkRecipe(reusedData, allAvoid).length > 0) throw new Error("reuse violates avoid list");
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
      let violatedTerms: string[] = [];
      let noteDropped = false;
      // TER-401 guard loop: initial attempt + ≤2 avoid-violation retries, each
      // retry with the violated terms explicitly emphasized in the prompt.
      for (let guardAttempt = 0; guardAttempt < 3 && !data; guardAttempt++) {
        let pendingHits: ReturnType<typeof checkRecipe> = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          // TER-544: a note that's contradictory/unintelligible can make the
          // model refuse or reply with prose on every retry — same doomed
          // prompt in, same failure out. On the last inner attempt, drop the
          // free-text "Extra request" line and let the run succeed without it.
          // Note-detected dietary terms stay enforced regardless (buildPrompt
          // derives avoidBlock from day.note independently of this flag).
          const dropNote = attempt === 2 && !!day.note;
          try {
            const candidate = await callClaude(buildPrompt(day, dateFor(idx), committed, usedCuisinesFrom(committed), rejected, violatedTerms, weekAvoid, dropNote));
            // TER-401 deterministic guard: runs after parse, BEFORE the save gate
            // and before any meals-state commit — a violating dish must never
            // render, even transiently.
            pendingHits = checkRecipe(candidate, allAvoid);
            if (pendingHits.length) break; // discard candidate; regenerate via guard loop
            // Gate: server validates and saves. Hard fail → retry; transport/5xx → fail open.
            if (tok) {
              try {
                const vr = await fetch("/api/recipes", {
                  method: "POST",
                  headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
                  body: JSON.stringify(candidate),
                });
                if (vr.status === 422) throw new Error("bad shape");
                if (!vr.ok) throw new Error(`save error ${vr.status}`);
              } catch (fe: any) {
                if (fe?.message === "bad shape") throw fe;
                console.warn("Recipe save endpoint error — failing open:", fe);
              }
            }
            data = candidate;
            if (dropNote) noteDropped = true;
            break;
          } catch (e: any) {
            const retryable = e?.truncated || e instanceof SyntaxError || e?.message === "bad shape" || e?.transient;
            if (!retryable) throw e;
            if (attempt === 2) {
              throw new Error(day.note
                ? "Couldn't generate this recipe — your day note may be too restrictive. Try simplifying it, then regenerate."
                : "Couldn't generate this recipe — try again.");
            }
            // TER-545: transient upstream errors (529/500/unmarked 429) get a short
            // backoff before retrying; existing retry cases keep no-delay behavior.
            if (e?.transient) await new Promise((r) => setTimeout(r, attempt === 0 ? 1000 : 2000));
          }
        }
        if (pendingHits.length) {
          violatedTerms = mergeTerms(violatedTerms, pendingHits.map((h) => h.term));
          // Max 2 avoid retries, then a visible per-day error — no unbounded LLM
          // spend, no silent drop, never a committed violation.
          if (guardAttempt === 2) throw new Error(`Couldn't generate a dish avoiding ${violatedTerms.join(", ")} — try adjusting your avoid list or note, then regenerate.`);
        }
      }
      // TER-544: surface (never silently drop) when the note fallback fired.
      if (noteDropped) data.noteApplied = false;
      // TER-401: banner data comes from the structured term list (week-level
      // avoid list + note-detected terms), never from an LLM echo.
      if (allAvoid.length) data.dietaryAvoid = allAvoid;
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
      // TER-414: the day shows the server's quota message above; rethrow so
      // generateAll can halt the remaining days instead of 429ing each one.
      if (e?.quota) throw e;
      return null;
    }
  };

  // TER-401 addendum: pendingAvoid carries avoid-field text the user typed but
  // never confirmed with Enter/Add. It is committed to state AND merged into
  // the list this run uses directly — the setAvoidTerms update won't be visible
  // to this closure (React batching), so we never read avoidTerms back for it.
  const generateAll = async (pendingAvoid: string[] = []) => {
    const weekAvoid = mergeTerms(avoidTerms, pendingAvoid);
    if (pendingAvoid.length) setAvoidTerms((prev: string[]) => mergeTerms(prev, pendingAvoid));
    // TER-503: a fresh full-week generation starts with clean per-slot rejection
    // memory — it only governs single-slot re-rolls, never the initial plan.
    setRejectedBySlot({});
    setBusy(true); setTab("plan");
    // TER-428: seed the run's reuse context from the list scope (accepted,
    // unshopped, today-forward — every planned week), not the window's accepted
    // meals. Ready proposals are left out of the seed: the loop below
    // regenerates them, and each fresh result is pushed in as it lands.
    const committed = listScopeFromModel(liveModel, isoToday()).map((e) => e.meal.data).filter(Boolean);
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      if (!!day.skip) continue; // skip overrides pin
      if (day.pinnedRecipe) continue;
      if (meals[day.id]?.status === "accepted") continue;
      let data: any = null;
      try {
        data = await generateOne(day, i, [...committed], [], weekAvoid);
      } catch {
        // TER-414: only quota errors propagate out of generateOne — every
        // remaining day would 429 too, so halt the run here.
        break;
      }
      if (data) committed.push(data);
    }
    setBusy(false);
  };

  const acceptMeal = (id: string) => {
    setMeals((m) => ({ ...m, [id]: { ...m[id], status: "accepted" } }));
    // TER-503: accepting a slot ends its re-roll session — clear its rejection memory.
    setRejectedBySlot((m) => {
      if (!(id in m)) return m;
      const next = { ...m }; delete next[id]; return next;
    });
  };
  const rejectMeal = async (day: any, idx: number) => {
    if (day.pinnedRecipe) return;
    // TER-503: accumulate the currently-displayed dish into this slot's rejection
    // memory and pass the FULL set to generateOne, so a re-roll never cycles back
    // to an earlier-rejected dish. Computed locally — the setState below won't be
    // visible to this run (React batching), mirroring the pendingAvoid pattern.
    const current = meals[day.id]?.data?.name;
    const prev = rejectedBySlot[day.id] ?? [];
    const rejected = current && !prev.includes(current) ? [...prev, current] : prev;
    if (current && rejected !== prev) setRejectedBySlot((m) => ({ ...m, [day.id]: rejected }));
    // TER-414: a quota error rethrows from generateOne after setting the day's
    // error state — nothing more to do for a single-day action.
    await generateOne(day, idx, committedData(dateFor(idx)), rejected).catch(() => {});
  };

  // TER-422: resetPlan and "Start over" are gone — there is no bulk-clear path.
  // Rejecting a meal is the only operation that empties a date; "mark ordered"
  // stamps meals instead of clearing them (see handleMarkOrdered below).
  // TER-428 (decision locked): do NOT re-add a bulk clear, reset, or escape
  // hatch in any form. Per-date rejection and ordered stamps are the only
  // mutations; everything else is navigation.

  const thumbUp = (name: string) => { if (name) setLiked((p) => (p.includes(name) ? p : [...p, name])); };
  const thumbDown = async (day: any, idx: number) => {
    if (day.pinnedRecipe) return;
    const name = meals[day.id]?.data?.name;
    if (name) { setAvoid((p) => (p.includes(name) ? p : [...p, name])); setLiked((p) => p.filter((x) => x !== name)); }
    await rejectMeal(day, idx);
  };
  const addToRotation = (data: any) => { setRotation((p) => (p.some((r) => r.name === data.name) ? p : [...p, data])); thumbUp(data.name); };

  /* ---- grocery list ---- */
  const acceptedCount = useMemo(() => days.filter((d) => meals[d.id]?.status === "accepted").length, [days, meals]);

  // TER-422/TER-426: the shopping-list scope — accepted, dated today or later, not
  // yet stamped ordered, across the FULL forward range of the date model (every
  // planned week at once, not just the current window). Everything list-shaped
  // (groceryList → listText → Instacart handoff → the orders snapshot) derives
  // from this set.
  const todayISO = isoToday();
  const scopeEntries = useMemo(() => listScopeFromModel(liveModel, todayISO), [liveModel, todayISO]);

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
    // TER-400: enforce the reuse/buy-source invariant before aggregating, so an ingredient
    // marked "reused" in every meal (never bought) is promoted to buy and can't be omitted
    // from the list or the Instacart handoff. Since TER-422 the repair runs over the list
    // scope (accepted ∧ date ≥ today ∧ not ordered) — the same set the list aggregates.
    const scopeWeek: any[] = scopeEntries.map((e) => e.meal.data);
    const { week: repairedWeek, promotions } = repairWeek(scopeWeek);
    promotions.forEach((p) => console.warn(
      `[ingredientFlow] "${p.name}" was reuse-only (days ${p.reusedDays.map((x) => x + 1).join(", ")}) — promoted to buy in "${p.recipeName}" (day ${p.day + 1})`
    ));
    repairedWeek.forEach((r) => r.ingredients.forEach(pushIngredient));
    staples.filter((st) => st.enabled).forEach((st) => {
      const k = `${normalizeIngName(st.name)}|${st.unit.toLowerCase()}`;
      if (!agg[k]) agg[k] = { name: st.name, qty: 0, unit: st.unit, category: CATEGORIES.includes(st.category) ? st.category : "Other", staple: false, isPurchaseStyle: false };
      agg[k].qty += Number(st.qty) || 0;
      agg[k].staple = true;
    });
    const byCat: Record<string, any[]> = {}; CATEGORIES.forEach((c) => (byCat[c] = []));
    Object.values(agg).forEach((it: any) => {
      if (it.qty === 0) return;
      // TER-330 durable `alwaysHave` + TER-504 per-week `weekHaveIt` exclusion — one
      // chokepoint so listText, Instacart handoff, and every view stay consistent.
      if (isExcludedFromWeeklyList(it.name, alwaysHave, weekHaveIt)) return;
      (byCat[it.category] || byCat.Other).push(it);
    });
    CATEGORIES.forEach((c) => byCat[c].sort((a, b) => a.name.localeCompare(b.name)));
    return byCat;
  }, [scopeEntries, staples, alwaysHave, weekHaveIt]);

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

  // TER-422: "mark ordered" stamps `orderedAt` on each scope meal instead of clearing
  // anything. Meals stay on their dates and in every view; the shopping list (scope-
  // derived) empties on its own. The orders history row inserts exactly as before;
  // checked items and manual additions clear because they belong to the completed
  // trip. No startDate change, no This Week clear, no day-config reset.
  const handleMarkOrdered = async (): Promise<{ error: string | null }> => {
    const scope = scopeEntries;
    if (scope.length === 0) return { error: null };
    const snapshot = {
      startDate,
      numDays,
      location,
      meals: scope.map(({ date, meal }) => ({
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
        console.warn("Failed to save order:", error);
        return { error: error.message };
      }
      const orderedAt = new Date().toISOString();
      // TER-426: the scope spans the full forward range, so stamp both stores —
      // in-window dates through `meals` (the model re-merges them next commit),
      // out-of-window dates directly in the model (their only home).
      const windowDayIdByDate = new Map<string, string>(days.map((d, i) => [addDays(startDate, i), d.id]));
      setMeals((m) => {
        const next = { ...m };
        for (const { date } of scope) {
          const dayId = windowDayIdByDate.get(date);
          if (dayId && next[dayId]) next[dayId] = { ...next[dayId], orderedAt };
        }
        return next;
      });
      setDateModel((prev) => {
        const mealsByDate = { ...prev.mealsByDate };
        let changed = false;
        for (const { date } of scope) {
          if (mealsByDate[date]) { mealsByDate[date] = { ...mealsByDate[date], orderedAt }; changed = true; }
        }
        return changed ? { ...prev, mealsByDate } : prev;
      });
      setCheckedItems({});
      setWeekAdditions([]);
      setWeekHaveIt([]); // TER-504: per-week have-it overrides reset when the trip closes.
      setLastOrder({ dates: scope.map((e) => e.date), orderedAt });
      return { error: null };
    } catch (e: any) {
      console.warn("Failed to save order:", e);
      return { error: e?.message || "Network error — order not saved." };
    }
  };

  // TER-422: undo for the last stamp set this session — removes `orderedAt` so those
  // meals re-enter the shopping list. The saved orders row is left alone.
  // Unstamps both stores, mirroring handleMarkOrdered (TER-426).
  const unmarkLastOrder = () => {
    if (!lastOrder) return;
    const windowDayIdByDate = new Map<string, string>(days.map((d, i) => [addDays(startDate, i), d.id]));
    setMeals((m) => {
      const next = { ...m };
      for (const date of lastOrder.dates) {
        const dayId = windowDayIdByDate.get(date);
        if (dayId && next[dayId]?.orderedAt) {
          const { orderedAt: _removed, ...rest } = next[dayId];
          next[dayId] = rest;
        }
      }
      return next;
    });
    setDateModel((prev) => {
      const mealsByDate = { ...prev.mealsByDate };
      let changed = false;
      for (const date of lastOrder.dates) {
        if (mealsByDate[date]?.orderedAt) {
          const { orderedAt: _removed, ...rest } = mealsByDate[date];
          mealsByDate[date] = rest;
          changed = true;
        }
      }
      return changed ? { ...prev, mealsByDate } : prev;
    });
    setLastOrder(null);
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
      <RecipeImportHandler rotation={rotation} setRotation={setRotation} />
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
      </nav>

      <main style={s.main}>
        {(tab === "setup" || tab === "plan") && (
          <>
            <PlanningHeader tab={tab} setTab={setTab} acceptedCount={acceptedCount} slotCount={days.length} />
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
                avoidTerms={avoidTerms} setAvoidTerms={setAvoidTerms}
                alwaysHave={alwaysHave} setAlwaysHave={setAlwaysHave}
                weekNote={weekNote} setWeekNote={setWeekNote}
                onGenerate={generateAll} busy={busy} isMobile={isMobile}
              />
            )}
            {tab === "plan" && (
              <PlanView
                days={days} meals={meals} busy={busy} dateFor={dateFor} forecast={forecast}
                startDate={startDate} onShiftWeek={(delta: number) => setStartDate(addDays(startDate, delta))}
                onAccept={acceptMeal} onReject={rejectMeal}
                onThumbUp={(d: any) => thumbUp(meals[d.id]?.data?.name)} onThumbDown={thumbDown}
                onAddRotation={(d: any) => addToRotation(meals[d.id].data)}
                liked={liked} onGenerate={() => generateAll()}
                onAllAccepted={() => setTab("today")} acceptedCount={acceptedCount}
                session={session}
              />
            )}
          </>
        )}
        {tab === "today" && (
          <TodayCook
            mealsByDate={liveModel.mealsByDate}
            dayConfigByDate={liveModel.dayConfigByDate}
            onGoPlan={() => setTab("plan")}
            forecast={forecast}
            isMobile={isMobile}
            cookProgress={cookProgress}
            setCookProgress={setCookProgress}
            recipeStars={recipeStars}
            setRecipeStars={setRecipeStars}
            liked={liked} setLiked={setLiked}
            avoid={avoid} setAvoid={setAvoid}
            alwaysHave={alwaysHave}
          />
        )}
        {tab === "list" && (
          <ListView groceryList={groceryList} totalItems={totalItems} listText={listText}
            checkedItems={checkedItems} setCheckedItems={setCheckedItems}
            weekAdditions={weekAdditions} setWeekAdditions={setWeekAdditions}
            weekHaveIt={weekHaveIt} setWeekHaveIt={setWeekHaveIt}
            slotCount={days.length} location={location}
            onMarkOrdered={handleMarkOrdered} scopeCount={scopeEntries.length}
            canUnmark={!!lastOrder} onUnmarkOrder={unmarkLastOrder}
            alwaysHave={alwaysHave} setAlwaysHave={setAlwaysHave}
            session={session} qualificationNumber={qualificationNumber} setQualificationNumber={setQualificationNumber} />
        )}
        {tab === "rotation" && (
          <RotationView rotation={rotation} setRotation={setRotation} liked={liked} setLiked={setLiked} avoid={avoid} setAvoid={setAvoid} recipeStars={recipeStars} setRecipeStars={setRecipeStars} session={session} />
        )}
        {tab === "receipt" && <IngestView session={session} />}
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
    {acceptedMealsForPrint.length > 0 && (
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
                ["Per serving", meal.kcalInfo?.kcalPerServing != null ? `~${meal.kcalInfo.kcalPerServing} Calories` : "—"],
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
              <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-caption-size)", fontWeight: 600, color: "var(--c-text-muted)" }}>Calories source: USDA FoodData Central</span>
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
  const [unknownEmail, setUnknownEmail] = useState(false); // TER-412: 422 "Signups not allowed" → Request-access pointer, never the raw string
  const [otpCode, setOtpCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [signupSource] = useState<string | null>(() => new URLSearchParams(window.location.search).get("src"));

  const counting = resendIn > 0;
  useEffect(() => {
    if (!counting) return;
    const t = setInterval(() => setResendIn((n) => n - 1), 1000);
    return () => clearInterval(t);
  }, [counting]);

  // Shared send for first send and resend; mode picks signup metadata vs gated sign-in.
  const sendOtpEmail = async (): Promise<boolean> => {
    const addr = email.trim();
    if (!addr) { setError("Enter your email address."); return false; }
    if (!isValidEmail(addr)) { setError("That doesn't look like a valid email address."); return false; }
    if (mode === "signup" && (!firstName.trim() || !lastName.trim())) return false;
    setLoading(true);
    setError("");
    setUnknownEmail(false);
    const referredBy = mode === "signup" ? localStorage.getItem("referredBy") : null;
    const { error: err } = await supabase.auth.signInWithOtp({
      email: addr,
      options: mode === "signup"
        ? {
            shouldCreateUser: true,
            data: {
              first_name: firstName.trim(),
              last_name: lastName.trim(),
              name: `${firstName.trim()} ${lastName.trim()}`.trim(),
              nearest_aldi: nearestAldi.trim(),
              reason: reason.trim(),
              ...(referredBy ? { referred_by: referredBy } : {}),
              ...(signupSource ? { signup_source: signupSource } : {}),
            },
          }
        : { shouldCreateUser: false },
    });
    setLoading(false);
    if (err) {
      if (mode === "signin" && classifySendError(err) === "unknown_email") setUnknownEmail(true);
      else setError(friendlySendError(err));
      return false;
    }
    if (mode === "signup") { try { localStorage.removeItem("referredBy"); } catch {} }
    setResendIn(RESEND_COOLDOWN_S);
    return true;
  };

  const handleSend = async () => {
    if (loading) return;
    if (await sendOtpEmail()) { setSent(true); setOtpCode(""); setVerifyError(""); }
  };

  const handleResend = async () => {
    if (resendIn > 0 || loading) return;
    setVerifyError("");
    await sendOtpEmail();
  };

  const handleVerifyCode = async () => {
    if (otpCode.length !== OTP_LENGTH || verifying) return;
    setVerifying(true);
    setVerifyError("");
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim(), token: otpCode, type: "email" });
    setVerifying(false);
    if (err) { setVerifyError(friendlyVerifyError(err)); setOtpCode(""); }
    // Success needs nothing here: verifyOtp establishes the session and
    // onAuthStateChange in App swaps this view out, same as the magic link.
  };

  const switchMode = (m: "signin" | "signup") => {
    setMode(m); setError(""); setUnknownEmail(false); setSent(false); setOtpCode(""); setVerifyError("");
  };

  const consentLine = (
    <p style={{ fontSize: 11.5, color: "var(--c-text-muted)", margin: "12px 0 0", textAlign: "center" as const, lineHeight: 1.5 }}>
      By continuing you agree to our{" "}
      <a href="/terms.html" style={{ color: "var(--c-primary)" }}>Terms</a>
      {" · "}
      <a href="/privacy.html" style={{ color: "var(--c-primary)" }}>Privacy Policy</a>.
    </p>
  );

  if (sent) {
    const canVerify = otpCode.length === OTP_LENGTH && !verifying;
    return (
      <div style={{ ...s.card, maxWidth: 360, margin: "48px auto", textAlign: "center" as const }}>
        <h2 style={{ fontFamily: serif, fontSize: 18, fontWeight: 600, margin: "0 0 8px", color: "var(--c-text)" }}>Check your email</h2>
        <p style={{ fontSize: 13.5, color: "var(--c-text-muted)", margin: 0, lineHeight: 1.55 }}>
          We sent a sign-in email to <strong>{email.trim()}</strong>. Click the link in it, or enter the 6-digit code below.
          {mode === "signup" && <> Your account will be pending admin approval once you sign in.</>}
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_LENGTH}
          value={otpCode}
          onChange={(e) => { setOtpCode(sanitizeOtpCode(e.target.value)); if (verifyError) setVerifyError(""); }}
          onKeyDown={(e) => e.key === "Enter" && handleVerifyCode()}
          placeholder="123456"
          autoFocus
          style={{ ...s.input, width: "100%", marginTop: 14, textAlign: "center", fontSize: 18, letterSpacing: "0.3em", fontVariantNumeric: "tabular-nums" } as any}
        />
        {(verifyError || error) && (
          <p style={{ color: "var(--c-danger)", fontSize: 13, margin: "10px 0 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
            <AlertCircle size={14} /> {verifyError || error}
          </p>
        )}
        <button
          onClick={handleVerifyCode}
          disabled={!canVerify}
          style={{ ...s.primaryBtn, width: "100%", justifyContent: "center", marginTop: 10, opacity: canVerify ? 1 : 0.5 }}
        >
          {verifying ? <><RefreshCw size={16} className="spin" /> Verifying…</> : "Verify code"}
        </button>
        <button
          onClick={handleResend}
          disabled={resendIn > 0 || loading}
          style={{ background: "none", border: "none", marginTop: 12, padding: 4, fontSize: 12.5, fontFamily: sans, color: resendIn > 0 || loading ? "var(--c-text-muted)" : "var(--c-primary)", cursor: resendIn > 0 || loading ? "default" : "pointer" }}
        >
          {loading ? "Sending…" : resendIn > 0 ? `Resend email (${resendIn}s)` : "Resend email"}
        </button>
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
              onKeyDown={(e) => e.key === "Enter" && canSubmit && handleSend()}
              style={{ ...s.input, width: "100%", boxSizing: "border-box" } as any}
              placeholder="Tell us a little about yourself"
            />
          </div>
        </div>
        <button
          onClick={handleSend}
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
      {error && (
        <p style={{ color: "var(--c-danger)", fontSize: 13, margin: "10px 0 0", display: "flex", alignItems: "center", gap: 5 }}>
          <AlertCircle size={14} /> {error}
        </p>
      )}
      {unknownEmail && (
        <p style={{ color: "var(--c-danger)", fontSize: 13, margin: "10px 0 0", lineHeight: 1.5 }}>
          <AlertCircle size={14} style={{ verticalAlign: -2, marginRight: 5 }} />
          This email isn't on the beta list yet — tap{" "}
          <button
            onClick={() => switchMode("signup")}
            style={{ background: "none", border: "none", padding: 0, fontFamily: sans, fontSize: 13, fontWeight: 700, color: "var(--c-primary)", cursor: "pointer", textDecoration: "underline" }}
          >
            Request access
          </button>{" "}
          and we'll approve you shortly.
        </p>
      )}
      <input
        type="email"
        value={email}
        onChange={(e) => { setEmail(e.target.value); if (error) setError(""); if (unknownEmail) setUnknownEmail(false); }}
        onKeyDown={(e) => e.key === "Enter" && handleSend()}
        style={{ ...s.input, width: "100%", marginTop: 14, boxSizing: "border-box" } as any}
        placeholder="your@email.com"
        autoFocus
      />
      <button
        onClick={handleSend}
        disabled={!email.trim() || loading}
        style={{ ...s.primaryBtn, width: "100%", justifyContent: "center", marginTop: 10, opacity: email.trim() && !loading ? 1 : 0.5 }}
      >
        {loading ? <><RefreshCw size={16} className="spin" /> Sending…</> : "Send sign-in email"}
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

/* ============================ Planning (unified Setup + Meals) — TER-330 ============================ */
// Wraps the Setup and Meals panes under one screen with a segmented sub-toggle.
// The top-nav Planning group (TER-328) and this in-screen toggle both drive the
// same `tab` state ("setup" | "plan"), so either entry point opens the right pane.
function PlanningHeader({ tab, setTab, acceptedCount, slotCount }: { tab: string; setTab: (t: string) => void; acceptedCount: number; slotCount: number }) {
  const SubTab = ({ id, label, n }: { id: string; label: string; n: string }) => {
    const active = tab === id;
    return (
      <button onClick={() => setTab(id)} style={{ ...s.subTab, ...(active ? s.subTabActive : {}) }}>
        <span style={{ ...s.subBadge, ...(active ? s.subBadgeActive : {}) }}>{n}</span>
        {label}
      </button>
    );
  };
  return (
    <div>
      <div style={s.planHead}>
        <p style={s.planLabel}>Planning</p>
        <h1 style={{ ...s.typeH1, marginTop: 2 }}>Plan your week</h1>
        <p style={s.planSub}>Set it up, then review what we generated — two steps, one place.</p>
      </div>
      <div style={s.subToggle}>
        <SubTab id="setup" label="Setup" n="1" />
        <SubTab id="plan" label={`Meals (${acceptedCount}/${slotCount})`} n="2" />
      </div>
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

function PlanView({ days, meals, busy, dateFor, forecast, onAccept, onReject, onThumbUp, onThumbDown, onAddRotation, liked, onGenerate, onAllAccepted, acceptedCount, startDate, onShiftWeek, session }: any) {
  const firstMealIdx = days.findIndex((d: any) => meals[d.id]);
  const [activeMealIdx, setActiveMealIdx] = useState<number>(firstMealIdx >= 0 ? firstMealIdx : 0);

  // TER-428: stepping the planning window ±7 is pure navigation — the window
  // hydration machinery (TER-418/426) folds the old week into the date model
  // and rehydrates the new one; nothing is cleared, every week keeps its meals.
  const weekNav = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--space-2)" }}>
      <button onClick={() => onShiftWeek(-7)} aria-label="Previous week" className="btn-ghost btn--sm" style={{ minHeight: 0, padding: "8px 10px", flexShrink: 0 }}>
        <ChevronLeft size={16} strokeWidth={2.2} />
      </button>
      <span style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-label-size)", fontWeight: 700, letterSpacing: "var(--t-label-tracking)", textTransform: "uppercase" as const, color: "var(--c-primary)", whiteSpace: "nowrap" as const }}>
        Week of {parseISO(startDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </span>
      <button onClick={() => onShiftWeek(7)} aria-label="Next week" className="btn-ghost btn--sm" style={{ minHeight: 0, padding: "8px 10px", flexShrink: 0 }}>
        <ChevronRight size={16} strokeWidth={2.2} />
      </button>
    </div>
  );

  if (!days.some((d: any) => meals[d.id])) {
    return (
      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        {weekNav}
        <div style={s.card}>
          <p style={s.empty}>No meals yet for this week.</p>
          <button onClick={onGenerate} disabled={busy} className="btn-primary" style={{ marginTop: 12 }}>
            <Sparkles size={16} /> Generate meal plan
          </button>
        </div>
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
  const renderAcceptSwapButtons = (compact?: boolean) => (
    <>
      {m.status !== "accepted" && (
        <button
          onClick={() => onAccept(activeDay.id)}
          style={compact ? { ...s.acceptBtn, padding: "6px 12px", fontSize: 12 } : s.acceptBtn}
        >
          <Check size={compact ? 13 : 15} /> Accept
        </button>
      )}
      <button
        onClick={() => onReject(activeDay, safeIdx)}
        style={compact ? { ...s.rejectBtn, padding: "6px 12px", fontSize: 12 } : s.rejectBtn}
      >
        <RefreshCw size={compact ? 12 : 14} /> {m.status === "accepted" ? "Swap" : "Reject"}
      </button>
    </>
  );

  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      {weekNav}

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
              {/* Actions row (top, compact) */}
              {!isPinned && (
                <div style={{
                  display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" as const,
                  marginBottom: "var(--space-3)",
                }}>
                  {renderAcceptSwapButtons(true)}
                </div>
              )}

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
                    ~{m.kcalInfo.kcalPerServing} Calories
                    {m.kcalInfo.tier === "estimate" && (
                      <span style={{ background: "var(--c-warning-bg)", color: "var(--c-warning)", fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: "var(--radius-pill)", lineHeight: 1 }}>Est.</span>
                    )}
                  </span>
                )}
                {m.kcalInfo?.macrosPerServing && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "var(--t-bodysm-size)", color: "var(--c-text-muted)" }}>
                    P {m.kcalInfo.macrosPerServing.protein_g}g · F {m.kcalInfo.macrosPerServing.fat_g}g · C {m.kcalInfo.macrosPerServing.carbs_g}g{(m.kcalInfo.macrosEstimated || m.kcalInfo.tier === "estimate") ? " est." : ""}
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

              {m.data.noteApplied === false && (
                <div style={{ ...s.reuseNote, marginBottom: "var(--space-3)", color: "var(--c-warning)" }}>
                  <AlertCircle size={13} /> Your note for this day couldn't be applied — generated without it.
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
                  {renderAcceptSwapButtons()}
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
                  <ShareRecipeButton session={session} recipe={m.data} />
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
            <CalendarDays size={15} /> View This Week
          </button>
          <button onClick={() => window.print()} className="btn-ghost btn--sm">
            <Printer size={14} /> Print recipes
          </button>
        </div>
      )}
    </div>
  );
}

/* ============================ Today / Cook Mode (TER-329, rolling dates TER-426) ============================ */
function TodayCook({
  mealsByDate, dayConfigByDate, onGoPlan, forecast, isMobile,
  cookProgress, setCookProgress,
  recipeStars, setRecipeStars,
  liked, setLiked, avoid, setAvoid,
  alwaysHave,
}: any) {
  const today = isoToday();
  // TER-426: rolling date navigation — starts at today, unbounded both directions.
  // Forward through everything planned, backward through history.
  const [activeDate, setActiveDate] = useState(today);
  const [hoverStar, setHoverStar] = useState(0);

  // Dates with an accepted dinner, sorted — drives the "next dinner" jumps.
  const plannedDates: string[] = Object.keys(mealsByDate)
    .filter((d) => mealsByDate[d]?.status === "accepted" && !dayConfigByDate[d]?.skip)
    .sort();
  const nextPlanned = plannedDates.find((d) => d > activeDate);

  const meal = !dayConfigByDate[activeDate]?.skip && mealsByDate[activeDate]?.status === "accepted"
    ? mealsByDate[activeDate]
    : null;
  const data = meal?.data;
  // TER-428: an accepted entry with no recipe payload (corrupt/partial blob) is
  // a different situation than an unplanned day — say so instead of "Nothing planned".
  const corruptEntry = !!meal && !data;

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
    alwaysHave.includes(normalizeIngName(ing.name ?? "")); // TER-330: unified pantry exclusion

  const dayLabel = activeDate === today ? "Tonight" : activeDate > today ? "Upcoming" : "Earlier";
  const fxDay = forecast[activeDate];
  const wxDay = fxDay ? wx(fxDay.code) : null;

  const totalMin = (data?.prepMinutes ?? 0) + (data?.cookMinutes ?? 0);
  const difficulty: number | null = data?.difficulty ?? null;
  const diffLabel = difficulty != null ? (DIFFICULTY_LABELS[difficulty] ?? "") : "";
  const kcal = meal?.kcalInfo?.kcalPerServing ?? null;
  const macros = meal?.kcalInfo?.macrosPerServing ?? null;
  const macrosEst = meal?.kcalInfo?.macrosEstimated || meal?.kcalInfo?.tier === "estimate";

  const footerBase: React.CSSProperties = { position: "sticky", bottom: 0, background: "var(--c-surface)", borderTop: "1px solid var(--c-border)", padding: "var(--space-4) var(--space-5)", boxShadow: "0 -2px 10px rgba(26,58,52,.05)" };

  return (
    <div style={{ minHeight: "100%", background: "var(--c-bg)", display: "flex", flexDirection: "column" }}>
      {/* ── DATE NAV (TER-426: rolling, unbounded) ── */}
      <div style={{ background: "var(--c-surface)", borderBottom: "1px solid var(--c-border)", padding: "var(--space-4) var(--space-5)", boxShadow: "var(--elev-1)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <button onClick={() => setActiveDate(addDays(activeDate, -1))}
            aria-label="Previous day" className="btn-ghost btn--sm" style={{ minHeight: 0, padding: "10px 8px", flexShrink: 0 }}>
            <ChevronLeft size={18} strokeWidth={2.2} />
          </button>
          <div style={{ flex: 1, minWidth: 0, textAlign: "center" as const }}>
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-label-size)", fontWeight: 700, letterSpacing: "var(--t-label-tracking)", textTransform: "uppercase", color: "var(--c-primary)", margin: 0 }}>{dayLabel}</p>
            <h1 style={{ fontFamily: "var(--font-sans)", fontSize: isMobile ? 20 : "var(--t-h1-size)", fontWeight: 700, letterSpacing: "-0.01em", lineHeight: "var(--t-h1-lh)", color: "var(--c-text)", margin: "2px 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{weekdayLabel(activeDate)}</h1>
          </div>
          <button onClick={() => setActiveDate(addDays(activeDate, 1))}
            aria-label="Next day" className="btn-ghost btn--sm" style={{ minHeight: 0, padding: "10px 8px", flexShrink: 0 }}>
            <ChevronRight size={18} strokeWidth={2.2} />
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
          {activeDate !== today && (
            <button onClick={() => setActiveDate(today)} className="btn-secondary btn--sm" style={{ minHeight: 30, padding: "0 12px" }}>
              <CalendarDays size={14} /> Today
            </button>
          )}
          {wxDay && fxDay && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--c-surface-2)", border: "1px solid var(--c-border)", borderRadius: "var(--radius-pill)", padding: "5px 11px", fontSize: "var(--t-bodysm-size)", fontFamily: "var(--font-sans)", color: "var(--c-text)" }}>
              <span style={{ fontSize: 14 }}>{wxDay.e}</span>{fxDay.hi}°F
            </span>
          )}
          <button onClick={() => window.print()} className="btn-ghost btn--sm" aria-label="Print recipes" style={{ padding: "0 var(--space-2)", minHeight: 30 }}>
            <Printer size={15} />
          </button>
        </div>
      </div>

      {/* ── NOTHING PLANNED ── */}
      {!data ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--space-3)", padding: "var(--space-7)" }}>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "var(--t-body-size)", color: "var(--c-text-muted)", fontStyle: "italic", textAlign: "center", margin: 0 }}>{corruptEntry ? "Recipe data not available for this day." : "Nothing planned for this day."}</p>
          {nextPlanned && (
            <button onClick={() => setActiveDate(nextPlanned)} className="btn-secondary btn--sm">
              Next dinner: {weekdayLabel(nextPlanned)} <ChevronRight size={15} strokeWidth={2.2} />
            </button>
          )}
          <button onClick={onGoPlan} className="btn-ghost btn--sm">Plan dinners in Planning <ChevronRight size={14} strokeWidth={2} /></button>
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
                    <Flame size={15} color="var(--c-primary)" strokeWidth={1.8} />~{kcal} Calories
                  </span>
                )}
                {macros && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-sans)", fontSize: "var(--t-bodysm-size)", color: "var(--c-text-muted)" }}>
                    P {macros.protein_g}g · F {macros.fat_g}g · C {macros.carbs_g}g{macrosEst ? " est." : ""}
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
              {nextPlanned && (
                <button onClick={() => setActiveDate(nextPlanned)} className="btn-ghost" style={{ flexShrink: 0 }}>
                  Next dinner <ChevronRight size={16} strokeWidth={2.2} />
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
              {nextPlanned && (
                <button onClick={() => setActiveDate(nextPlanned)} className="btn-primary btn--block">
                  On to {weekdayLabel(nextPlanned)} <ChevronRight size={16} strokeWidth={2.2} />
                </button>
              )}
            </div>
          )}
        </>
      )}
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
          feature: "receipt_parse",
        }),
      });
      const data = await r.json();
      // TER-414: server-side limit errors (quota 429, model 400) put a plain
      // string in data.error — surface it instead of a bare status code.
      if (!r.ok) throw new Error(data?.error?.message ?? data?.error ?? `API error ${r.status}`);
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
        <p style={{ fontSize: 12.5, color: "var(--c-text-muted)", lineHeight: 1.6, marginTop: 8 }}>
          Text-paste only for now — photographing or scanning a paper receipt isn't supported yet. Get the text from your <strong>ALDI / Instacart order-confirmation email</strong>, or the <strong>Instacart app</strong> (Your Orders → the order → copy items). A physical-only receipt can be typed in following the placeholder format.
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
/* ============================ bits + styles ============================ */
function KcalBadge({ kcalPerServing, tier }: { kcalPerServing: number | null; tier: string }) {
  const isEst = tier === "estimate";
  const isUSDA = tier === "usda";
  const label = tier === "catalog" ? "ALDI catalog" : tier === "usda" ? "USDA" : "Estimated";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8, flexWrap: "wrap" as const }}>
      {kcalPerServing !== null ? (
        <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--c-text)" }}>
          {isEst ? "~" : ""}{kcalPerServing} Calories/serving
        </span>
      ) : (
        <span style={{ fontSize: 13, color: "var(--c-warning)" }}>— Calories/serving</span>
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
