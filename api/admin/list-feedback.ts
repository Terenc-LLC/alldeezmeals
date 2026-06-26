// TER-492: List submitted feedback for admin review.
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

  const { data: feedbackData, error } = await svc
    .from("feedback")
    .select("id, user_id, email, message, category, app_context, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) { res.status(500).json({ error: error.message }); return; }

  const { data: profiles } = await svc
    .from("profiles")
    .select("id, first_name, last_name, email");

  const profileMap = new Map<string, { first_name: string | null; last_name: string | null; email: string | null }>();
  for (const p of profiles ?? []) {
    profileMap.set(p.id, { first_name: p.first_name ?? null, last_name: p.last_name ?? null, email: p.email ?? null });
  }

  const feedback = (feedbackData ?? []).map(row => {
    const profile = row.user_id ? profileMap.get(row.user_id) : null;
    return {
      ...row,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
    };
  });

  res.status(200).json({ feedback });
}
