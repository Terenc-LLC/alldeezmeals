// TER-287: Authenticated route that revokes the owner's active share link(s).
// Mirrors the auth pattern in create.ts.

import { createClient } from "@supabase/supabase-js";
import { isApproved } from "../_approved.js";

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

  const { error: updateError } = await svc
    .from("shared_lists")
    .update({ revoked: true })
    .eq("user_id", userId)
    .eq("revoked", false)
    .or(`expires_at.is.null,expires_at.gt.${now}`);

  if (updateError) {
    console.error("shared_lists revoke failed:", updateError.message);
    res.status(500).json({ error: "Internal error" });
    return;
  }

  res.status(200).json({ revoked: true });
}
