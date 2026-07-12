// TER-515: dashboard landing — attention queue + headline metrics. Pure
// aggregation over existing tables (profiles, recipe_library,
// receipt_submissions, feedback, user_state, qualifications, llm_usage); no
// new schema.
import { createClient } from "@supabase/supabase-js";
import { getAuthedUser } from "./_admin.js";

const QUALIFICATION_CAP = 50;

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  const auth = await getAuthedUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!auth.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }

  const url = process.env.VITE_SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const svc = createClient(url, svcKey);

  const weekAgoISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    pendingUsersRes,
    pendingRecipesRes,
    pendingSubmissionsRes,
    unhandledFeedbackRes,
    approvedUsersRes,
    wauRes,
    qualCounterRes,
    llmUsageWeekRes,
  ] = await Promise.all([
    svc.from("profiles").select("id", { count: "exact", head: true }).eq("approved", false),
    svc.from("recipe_library").select("id", { count: "exact", head: true }).eq("review_status", "pending").is("base_recipe_id", null),
    svc.from("receipt_submissions").select("id", { count: "exact", head: true }).eq("status", "pending"),
    svc.from("feedback").select("id", { count: "exact", head: true }).eq("handled", false),
    svc.from("profiles").select("id", { count: "exact", head: true }).eq("approved", true),
    // WAU: distinct users with plan/state activity in the last 7 days.
    svc.from("user_state").select("user_id").gte("updated_at", weekAgoISO),
    svc.from("qualification_counter").select("count").eq("id", 1).maybeSingle(),
    svc.from("llm_usage").select("feature, cost_usd").gte("created_at", weekAgoISO),
  ]);

  const firstError = [
    pendingUsersRes, pendingRecipesRes, pendingSubmissionsRes, unhandledFeedbackRes,
    approvedUsersRes, wauRes, qualCounterRes, llmUsageWeekRes,
  ].find((r) => r.error)?.error;
  if (firstError) { res.status(500).json({ error: firstError.message }); return; }

  const wau = new Set((wauRes.data ?? []).map((r: any) => r.user_id)).size;
  const generationsThisWeek = (llmUsageWeekRes.data ?? []).filter((r: any) => r.feature === "meal_gen").length;
  const costThisWeekUsd = (llmUsageWeekRes.data ?? []).reduce((sum: number, r: any) => sum + (r.cost_usd ?? 0), 0);

  res.status(200).json({
    attention: {
      pendingUsers: pendingUsersRes.count ?? 0,
      pendingRecipes: pendingRecipesRes.count ?? 0,
      pendingSubmissions: pendingSubmissionsRes.count ?? 0,
      unhandledFeedback: unhandledFeedbackRes.count ?? 0,
    },
    headline: {
      wau,
      approvedUsers: approvedUsersRes.count ?? 0,
      qualified: qualCounterRes.data?.count ?? 0,
      qualifiedCap: QUALIFICATION_CAP,
      generationsThisWeek,
      costThisWeekUsd,
    },
  });
}
