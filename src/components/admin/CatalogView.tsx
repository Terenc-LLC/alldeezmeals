import { useState, useEffect } from "react";
import { RefreshCw, Check, Sparkles, AlertCircle } from "lucide-react";
import { supabase } from "@terenc/shared/supabase";
import { generateRecipeFromPrompt, buildSeedPrompt } from "../../lib/recipeGenerate.js";
import { s } from "../../lib/styles";

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

type AdminUser = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  approved: boolean;
  signup_source: string | null;
  created_at: string;
  last_active: string | null;
  recipes_generated: number;
  dinners_accepted: number;
  feedback_count: number;
  qualified: boolean;
  qualification_slot: number | null;
};

type FeedbackItem = {
  id: string;
  user_id: string | null;
  email: string | null;
  message: string;
  category: string | null;
  app_context: string | null;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
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

  // TER-368: unified user table
  const [allUsers, setAllUsers] = useState<AdminUser[]>([]);
  const [allUsersLoading, setAllUsersLoading] = useState(false);
  const [allUsersSortCol, setAllUsersSortCol] = useState<"created_at" | "last_active" | "recipes_generated">("created_at");
  const [allUsersSortDir, setAllUsersSortDir] = useState<"asc" | "desc">("desc");
  const [allUsersFilter, setAllUsersFilter] = useState<"all" | "pending" | "approved" | "qualified">("all");
  const [approvingUserId, setApprovingUserId] = useState<string | null>(null);

  // TER-492: feedback viewer
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

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

  useEffect(() => { loadItems(); loadSubmissions(); loadAllUsers(); loadQualifiedUsers(); loadPendingRecipes(); loadFeedback(); }, []);

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

  const loadAllUsers = async () => {
    const token = session?.access_token ?? "";
    if (!token) return;
    setAllUsersLoading(true);
    try {
      const r = await fetch("/api/admin/users", { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) { setAllUsersLoading(false); return; }
      const data = await r.json();
      setAllUsers(data.users ?? []);
    } catch { /* ignore */ }
    setAllUsersLoading(false);
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
      setAllUsers(p => p.map(u => u.id === userId ? { ...u, approved: true } : u));
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
      setAllUsers(p => p.filter(u => u.id !== userId));
    } catch (e: any) {
      alert(`Reject failed: ${e?.message ?? "Unknown error"}`);
    }
    setApprovingUserId(null);
  };

  const handleGrantQualForUser = async (userId: string, email: string) => {
    const token = session?.access_token ?? "";
    setApprovingUserId(userId);
    try {
      const r = await fetch("/api/admin/grant-qualification", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ email }),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error ?? `Error ${r.status}`); }
      else if (d.alreadyQualified) { alert(`Already qualified — #${d.number} of 50`); }
      else if (d.capReached) { alert("Cap reached (50 of 50)"); }
      else {
        setAllUsers(p => p.map(u => u.id === userId ? { ...u, qualified: true, qualification_slot: d.number } : u));
        await loadQualifiedUsers();
      }
    } catch (e: any) {
      alert(`Grant qual failed: ${e?.message ?? "Unknown error"}`);
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

  const loadFeedback = async () => {
    const token = session?.access_token ?? "";
    if (!token) return;
    setFeedbackLoading(true);
    try {
      const r = await fetch("/api/admin/list-feedback", { headers: { authorization: `Bearer ${token}` } });
      if (!r.ok) { setFeedbackLoading(false); return; }
      const data = await r.json();
      setFeedback(data.feedback ?? []);
    } catch { /* ignore */ }
    setFeedbackLoading(false);
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
        // TER-414: daily quota hit — every remaining target would 429 too.
        if (e?.quota) break;
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
      setStatusMsg(p => ({ ...p, [item.id]: { ok: true, msg: `Saved from ${srcLabel} — ${Math.round(nutData.kcal_per_100g)} Calories/100g` } }));
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
      {/* ── Users (TER-368) ── */}
      <div style={{ ...s.card, marginBottom: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ ...s.cardTitle, margin: 0 }}>
            Users ({allUsersLoading ? "…" : allUsers.length})
          </h3>
          <button onClick={loadAllUsers} style={s.ghostBtn} disabled={allUsersLoading}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {(["all", "pending", "approved", "qualified"] as const).map(f => (
            <button
              key={f}
              onClick={() => setAllUsersFilter(f)}
              style={{ ...s.ghostBtn, fontWeight: allUsersFilter === f ? 700 : 400, borderColor: allUsersFilter === f ? "var(--c-primary)" : "var(--c-border)" }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {allUsersLoading && <p style={s.empty}>Loading…</p>}
        {!allUsersLoading && allUsers.length === 0 && <p style={s.empty}>No users.</p>}
        {!allUsersLoading && allUsers.length > 0 && (() => {
          const visibleUsers = allUsers.filter(u => {
            if (allUsersFilter === "pending") return !u.approved;
            if (allUsersFilter === "approved") return u.approved;
            if (allUsersFilter === "qualified") return u.qualified;
            return true;
          });
          const sortedUsers = [...visibleUsers].sort((a, b) => {
            let av: any, bv: any;
            if (allUsersSortCol === "last_active") { av = a.last_active ?? ""; bv = b.last_active ?? ""; }
            else if (allUsersSortCol === "recipes_generated") { av = a.recipes_generated; bv = b.recipes_generated; }
            else { av = a.created_at; bv = b.created_at; }
            if (av < bv) return allUsersSortDir === "asc" ? -1 : 1;
            if (av > bv) return allUsersSortDir === "asc" ? 1 : -1;
            return 0;
          });
          const toggleSort = (col: typeof allUsersSortCol) => {
            if (allUsersSortCol === col) setAllUsersSortDir(d => d === "asc" ? "desc" : "asc");
            else { setAllUsersSortCol(col); setAllUsersSortDir("desc"); }
          };
          const sortArrow = (col: typeof allUsersSortCol) => allUsersSortCol === col ? (allUsersSortDir === "asc" ? " ↑" : " ↓") : "";
          const fmtDate = (iso: string | null) => iso
            ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
            : "—";
          const thStyle = (clickable?: boolean): React.CSSProperties => ({
            textAlign: "left", padding: "6px 8px", fontWeight: 600, color: "var(--c-text-muted)",
            whiteSpace: "nowrap", ...(clickable ? { cursor: "pointer", userSelect: "none" } : {}),
          });
          return (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, background: "var(--c-surface-raised)" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--c-border)" }}>
                    <th style={thStyle()}>Name</th>
                    <th style={thStyle()}>Email</th>
                    <th style={thStyle()}>Status</th>
                    <th style={thStyle()}>Qualified</th>
                    <th style={thStyle(true)} onClick={() => toggleSort("created_at")}>Signed up{sortArrow("created_at")}</th>
                    <th style={thStyle(true)} onClick={() => toggleSort("last_active")}>Last active{sortArrow("last_active")}</th>
                    <th style={thStyle(true)} onClick={() => toggleSort("recipes_generated")}>Recipes generated{sortArrow("recipes_generated")}</th>
                    {/* TER-499: display-only (not sortable) for v1 — matches the Feedback column. */}
                    <th style={thStyle()}>Dinners accepted</th>
                    <th style={thStyle()}>Accept rate</th>
                    {/* TODO(TER-499): "Recipes reused" column — deferred until reuse tracking exists (no data source yet). */}
                    <th style={thStyle()}>Feedback</th>
                    <th style={thStyle()}>Source</th>
                    <th style={thStyle()}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedUsers.map(user => {
                    const isBusy = approvingUserId === user.id;
                    const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || "—";
                    return (
                      <tr key={user.id} style={{ borderBottom: "1px solid var(--c-border)", background: !user.approved ? "color-mix(in srgb, var(--c-warning-bg) 30%, transparent)" : "transparent" }}>
                        <td style={{ padding: "7px 8px", color: "var(--c-text)", whiteSpace: "nowrap" }}>{displayName}</td>
                        <td style={{ padding: "7px 8px", color: "var(--c-text-muted)" }}>{user.email}</td>
                        <td style={{ padding: "7px 8px" }}>
                          {user.approved
                            ? <span style={{ background: "var(--c-success-bg)", color: "var(--c-success-text)", borderRadius: 4, padding: "2px 7px", fontSize: 11.5, fontWeight: 600 }}>Approved</span>
                            : <span style={{ background: "var(--c-warning-bg)", color: "var(--c-warning)", borderRadius: 4, padding: "2px 7px", fontSize: 11.5, fontWeight: 600 }}>Pending</span>
                          }
                        </td>
                        <td style={{ padding: "7px 8px" }}>
                          {user.qualified
                            ? <span style={{ background: "var(--c-success-bg)", color: "var(--c-success-text)", borderRadius: 4, padding: "2px 7px", fontSize: 11.5, fontWeight: 600 }}>#{user.qualification_slot}</span>
                            : <span style={{ color: "var(--c-text-muted)" }}>—</span>
                          }
                        </td>
                        <td style={{ padding: "7px 8px", color: "var(--c-text-muted)", whiteSpace: "nowrap" }}>{fmtDate(user.created_at)}</td>
                        <td style={{ padding: "7px 8px", color: "var(--c-text-muted)", whiteSpace: "nowrap" }}>{fmtDate(user.last_active)}</td>
                        <td style={{ padding: "7px 8px", color: "var(--c-text)", textAlign: "center" }}>{user.recipes_generated}</td>
                        <td style={{ padding: "7px 8px", color: "var(--c-text)", textAlign: "center" }}>{user.dinners_accepted}</td>
                        {/* Accept rate = dinners_accepted / recipes_generated — perceived-quality read; guard ÷0 → "—". */}
                        <td style={{ padding: "7px 8px", color: "var(--c-text)", textAlign: "center" }}>
                          {user.recipes_generated > 0 ? `${Math.round((user.dinners_accepted / user.recipes_generated) * 100)}%` : "—"}
                        </td>
                        <td style={{ padding: "7px 8px", color: "var(--c-text)", textAlign: "center" }}>{user.feedback_count}</td>
                        <td style={{ padding: "7px 8px", color: "var(--c-text-muted)" }}>{user.signup_source ?? "—"}</td>
                        <td style={{ padding: "7px 8px" }}>
                          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" as const }}>
                            {!user.approved && (
                              <>
                                <button onClick={() => handleApproveUser(user.id)} style={{ ...s.primaryBtn, padding: "3px 8px", fontSize: 11.5 }} disabled={isBusy}>
                                  {isBusy ? "…" : "Approve"}
                                </button>
                                <button onClick={() => handleRejectUser(user.id, user.email)} style={{ ...s.iconBtn, padding: "3px 8px", fontSize: 11.5 }} disabled={isBusy}>
                                  Reject
                                </button>
                              </>
                            )}
                            {user.approved && !user.qualified && (
                              <button onClick={() => handleGrantQualForUser(user.id, user.email)} style={{ ...s.ghostBtn, padding: "3px 8px", fontSize: 11.5 }} disabled={isBusy}>
                                {isBusy ? "…" : "Grant Qual"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {sortedUsers.length === 0 && <p style={s.empty}>No users match this filter.</p>}
            </div>
          );
        })()}
      </div>
      {/* ── Feedback (TER-492) ── */}
      <div style={{ ...s.card, marginBottom: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h3 style={{ ...s.cardTitle, margin: 0 }}>
            Feedback ({feedbackLoading ? "…" : feedback.length})
          </h3>
          <button onClick={loadFeedback} style={s.ghostBtn} disabled={feedbackLoading}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
        {feedbackLoading && <p style={s.empty}>Loading…</p>}
        {!feedbackLoading && feedback.length === 0 && <p style={s.empty}>No feedback submitted yet.</p>}
        {feedback.map(fb => {
          const name = [fb.first_name, fb.last_name].filter(Boolean).join(" ") || fb.email || "—";
          const categoryLabel = fb.category === "bug" ? "Bug" : fb.category === "idea" ? "Idea" : fb.category === "other" ? "Other" : fb.category ?? "—";
          return (
            <div key={fb.id} style={{ ...s.dayBlock, marginBottom: 8, padding: "10px 12px" }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" as const, alignItems: "baseline", marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: "var(--c-text)" }}>{name}</span>
                <span style={{ fontSize: 11.5, background: "var(--c-surface-2)", color: "var(--c-text-muted)", borderRadius: 4, padding: "1px 6px" }}>{categoryLabel}</span>
                {fb.app_context && (
                  <span style={{ fontSize: 11.5, color: "var(--c-text-muted)" }}>{fb.app_context}</span>
                )}
                <span style={{ fontSize: 11, color: "var(--c-text-muted)", marginLeft: "auto" }}>
                  {new Date(fb.created_at).toLocaleString()}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--c-text)", lineHeight: 1.5 }}>{fb.message}</p>
            </div>
          );
        })}
      </div>
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
                        <li key={i}>{ing.recipeAmount?.qty != null ? `${ing.recipeAmount.qty}${ing.recipeAmount.unit ? " " + ing.recipeAmount.unit : ""} ` : ""}{ing.name}{ing.source && ing.source !== "buy" ? <span style={{ color: "var(--c-text-muted)", fontStyle: "italic" }}>{" "}({ing.source})</span> : null}</li>
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
                    <span style={{ fontSize: 11.5, color: "var(--c-text-muted)", fontWeight: 600 }}>{Math.round(item.kcal_per_100g!)} Calories</span>
                  )}
                </div>
              </div>
              <span style={{ marginLeft: 10, color: "var(--c-text-muted)", fontSize: 11 }}>{expanded ? "▲" : "▼"}</span>
            </button>

            {expanded && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--c-border)", paddingTop: 12, display: "grid", gap: 12 }}>
                {hasNutrition && (
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" as const, fontSize: 12.5, color: "var(--c-text-muted)", alignItems: "center" }}>
                    <span><strong>{Math.round(item.kcal_per_100g!)} Calories</strong>/100g</span>
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
                      { label: "Calories/100g", key: "kcal" as const, w: 80 },
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

export { CatalogView };
