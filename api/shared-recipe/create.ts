// TER-526: Authenticated route that creates a shared-recipe token. Idempotent per
// (user_id, recipe name) — resharing the same recipe returns the existing live link.
// user_id is derived from the validated JWT — never from client-supplied input.

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { isApproved } from "../_approved.js";

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

  const approved = await isApproved(bearerToken, userId);
  if (!approved) { res.status(403).json({ error: "Account pending approval" }); return; }

  let body: { recipe?: any };
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const recipe = body.recipe;
  if (!recipe || typeof recipe.name !== "string" || !recipe.name.trim() || !Array.isArray(recipe.ingredients)) {
    res.status(400).json({ error: "recipe with name and ingredients array is required" });
    return;
  }

  const svc = createClient(supabaseUrl, serviceRoleKey);

  // Idempotent per (user_id, recipe name): reuse an existing live link if present.
  const { data: existing, error: lookupError } = await svc
    .from("shared_recipes")
    .select("token")
    .eq("user_id", userId)
    .eq("revoked", false)
    .eq("snapshot->>name", recipe.name)
    .maybeSingle();

  if (lookupError) {
    console.error("shared_recipes lookup failed:", lookupError.message);
    res.status(500).json({ error: "Failed to create share link" });
    return;
  }

  if (existing) {
    res.status(200).json({ token: existing.token, url: `/r/${existing.token}` });
    return;
  }

  const token = makeToken();

  const { error: insertError } = await svc.from("shared_recipes").insert({
    token,
    user_id: userId,
    snapshot: recipe,
  });

  if (insertError) {
    console.error("shared_recipes insert failed:", insertError.message);
    res.status(500).json({ error: "Failed to create share link" });
    return;
  }

  res.status(200).json({ token, url: `/r/${token}` });
}
