// TER-368: unified admin user list with engagement metrics
import { createClient } from "@supabase/supabase-js";
import { getAuthedUser } from "../_admin.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  const auth = await getAuthedUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!auth.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }

  const url = process.env.VITE_SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const svc = createClient(url, svcKey);

  const [profilesRes, userStateRes, llmRes, qualsRes, feedbackRes] = await Promise.all([
    svc.from("profiles").select("id, email, first_name, last_name, approved, signup_source, requested_at").order("requested_at", { ascending: false }),
    svc.from("user_state").select("user_id, updated_at"),
    svc.from("llm_usage").select("user_id").eq("feature", "generate"),
    svc.from("qualifications").select("user_id, qualification_number"),
    svc.from("feedback").select("user_id"),
  ]);

  if (profilesRes.error) { res.status(500).json({ error: profilesRes.error.message }); return; }

  const userStateMap = new Map<string, string>();
  for (const row of userStateRes.data ?? []) userStateMap.set(row.user_id, row.updated_at);

  const planCountMap = new Map<string, number>();
  for (const row of llmRes.data ?? []) planCountMap.set(row.user_id, (planCountMap.get(row.user_id) ?? 0) + 1);

  const qualsMap = new Map<string, number>();
  for (const row of qualsRes.data ?? []) qualsMap.set(row.user_id, row.qualification_number);

  const feedbackCountMap = new Map<string, number>();
  for (const row of feedbackRes.data ?? []) feedbackCountMap.set(row.user_id, (feedbackCountMap.get(row.user_id) ?? 0) + 1);

  const users = (profilesRes.data ?? []).map(p => ({
    id: p.id as string,
    email: (p.email ?? "") as string,
    first_name: (p.first_name ?? null) as string | null,
    last_name: (p.last_name ?? null) as string | null,
    approved: (p.approved ?? false) as boolean,
    signup_source: (p.signup_source ?? null) as string | null,
    created_at: p.requested_at as string,
    last_active: (userStateMap.get(p.id) ?? null) as string | null,
    plan_count: planCountMap.get(p.id) ?? 0,
    feedback_count: feedbackCountMap.get(p.id) ?? 0,
    qualified: qualsMap.has(p.id),
    qualification_slot: qualsMap.get(p.id) ?? null,
  }));

  res.status(200).json({ users });
}
