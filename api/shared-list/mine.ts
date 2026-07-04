// TER-287: Authenticated route returning the owner's active share-link status + helper progress.
// Mirrors the auth pattern in create.ts. Read-only — never mints or mutates a token.

import { createClient } from "@supabase/supabase-js";
import { isApproved } from "../_approved.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
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

  const approved = await isApproved(bearerToken, userId);
  if (!approved) { res.status(403).json({ error: "Account pending approval" }); return; }

  const svc = createClient(supabaseUrl, serviceRoleKey);
  const now = new Date().toISOString();

  // Option A guarantees at most one active row per owner.
  const { data, error } = await svc
    .from("shared_lists")
    .select("token, snapshot, check_state, expires_at")
    .eq("user_id", userId)
    .eq("revoked", false)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("shared_lists mine lookup failed:", error.message);
    res.status(500).json({ error: "Internal error" });
    return;
  }

  if (!data) {
    res.status(200).json({ active: false });
    return;
  }

  const totalCount = Array.isArray(data.snapshot?.items) ? data.snapshot.items.length : 0;
  const checkedCount = data.check_state ? Object.keys(data.check_state).length : 0;

  res.status(200).json({
    active: true,
    url: `/s/${data.token}`,
    token: data.token,
    expires_at: data.expires_at,
    checked_count: checkedCount,
    total_count: totalCount,
  });
}
