// TER-285: Authenticated route that creates a shared-list token (Option A: one active link per owner).
// user_id is derived from the validated JWT — never from client-supplied input.

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { isApproved } from "../_approved.js";

type SnapshotItem = {
  name: string;
  qty: number;
  unit: string;
  category: string;
};

function makeToken(): string {
  return randomBytes(16).toString("base64url");
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }

  // Validate JWT; derive user_id server-side — never from client input.
  const authHeader = (req.headers["authorization"] as string) ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!bearerToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const anonClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: userData, error: authError } = await anonClient.auth.getUser(bearerToken);
  if (authError || !userData.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const userId = userData.user.id;

  // TER-429 (T-9): only approved users may mint share links.
  const approved = await isApproved(bearerToken, userId);
  if (!approved) { res.status(403).json({ error: "Account pending approval" }); return; }

  let body: { items?: SnapshotItem[] };
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    res.status(400).json({ error: "items array is required" });
    return;
  }

  // Build frozen, no-PII snapshot: only name, qty, unit (package size), category.
  const snapshot: { items: SnapshotItem[] } = {
    items: body.items.map((it) => ({
      name: String(it.name || "").trim(),
      qty: Number(it.qty) || 0,
      unit: String(it.unit || "").trim(),
      category: String(it.category || "").trim(),
    })),
  };

  const svc = createClient(supabaseUrl, serviceRoleKey);

  // Option A: revoke any existing non-revoked, non-expired token for this owner before insert.
  const now = new Date().toISOString();
  await svc
    .from("shared_lists")
    .update({ revoked: true })
    .eq("user_id", userId)
    .eq("revoked", false)
    .or(`expires_at.is.null,expires_at.gt.${now}`);

  const token = makeToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { error: insertError } = await svc.from("shared_lists").insert({
    token,
    user_id: userId,
    snapshot,
    check_state: {},
    expires_at: expiresAt,
  });

  if (insertError) {
    console.error("shared_lists insert failed:", insertError.message);
    res.status(500).json({ error: "Failed to create share link" });
    return;
  }

  res.status(200).json({ token, url: `/s/${token}` });
}
