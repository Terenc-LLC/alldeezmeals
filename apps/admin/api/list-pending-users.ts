// TER-238: List pending (unapproved) user profiles for admin review.
import { createClient } from "@supabase/supabase-js";
import { getAuthedUser } from "./_admin.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  const auth = await getAuthedUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!auth.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }

  const url = process.env.VITE_SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const svc = createClient(url, svcKey);

  const { data, error } = await svc
    .from("profiles")
    .select("id, email, name, nearest_aldi, reason, requested_at")
    .eq("approved", false)
    .order("requested_at", { ascending: false })
    .limit(50);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(200).json({ users: data ?? [] });
}
