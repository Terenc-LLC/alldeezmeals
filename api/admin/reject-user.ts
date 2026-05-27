// TER-238: Reject a pending user — deletes from auth.users (cascades to profiles).
// Using deleteUser so the auth record is gone and the user cannot re-sign-in immediately.
import { createClient } from "@supabase/supabase-js";
import { getAuthedUser } from "../_admin.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const auth = await getAuthedUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!auth.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }

  let body: any;
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { res.status(400).json({ error: "Invalid JSON" }); return; }
  const { userId } = body ?? {};
  if (typeof userId !== "string" || !userId) {
    res.status(400).json({ error: "userId required" }); return;
  }

  const url = process.env.VITE_SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const svc = createClient(url, svcKey);

  const { error } = await svc.auth.admin.deleteUser(userId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(200).json({ ok: true });
}
