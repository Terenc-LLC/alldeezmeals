// TER-285: Public read route — the only unauthenticated endpoint in the app.
// Returns only { snapshot, check_state }. Never exposes user_id or any other column.

import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }

  const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
  if (!token) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const svc = createClient(supabaseUrl, serviceRoleKey);

  const { data, error } = await svc
    .from("shared_lists")
    .select("snapshot, check_state, revoked, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.error("shared_lists lookup failed:", error.message);
    res.status(500).json({ error: "Internal error" });
    return;
  }

  if (!data) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const expired = data.expires_at ? new Date(data.expires_at) < new Date() : false;
  if (data.revoked || expired) {
    res.status(410).json({ error: "Gone" });
    return;
  }

  res.status(200).json({ snapshot: data.snapshot, check_state: data.check_state });
}
