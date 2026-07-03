// TER-286: Public check-off write-back. Unauthenticated (the helper has no account).
// Writes ONLY the check_state column of the token row. Never touches or returns user_id.
// Mirrors the validation structure of api/shared-list/[token].ts (404/410/405/500 semantics).

import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
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

  let body: { index?: number; checked?: boolean };
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const { index, checked } = body;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    res.status(400).json({ error: "index must be a non-negative integer" });
    return;
  }
  if (typeof checked !== "boolean") {
    res.status(400).json({ error: "checked must be a boolean" });
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

  const itemCount = Array.isArray(data.snapshot?.items) ? data.snapshot.items.length : 0;
  if (index >= itemCount) {
    res.status(400).json({ error: "index out of bounds" });
    return;
  }

  // Read-modify-write. Option A guarantees a single active link → last-write-wins is fine.
  const nextCheckState: Record<string, true> = { ...(data.check_state ?? {}) };
  if (checked) {
    nextCheckState[String(index)] = true;
  } else {
    delete nextCheckState[String(index)];
  }

  const { error: updateError } = await svc
    .from("shared_lists")
    .update({ check_state: nextCheckState })
    .eq("token", token);

  if (updateError) {
    console.error("shared_lists check update failed:", updateError.message);
    res.status(500).json({ error: "Internal error" });
    return;
  }

  res.status(200).json({ check_state: nextCheckState });
}
