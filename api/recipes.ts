// TER-304: Recipe library P1 — save generated originals to the global recipe_library.
// Authenticated, service-role. Mirrors api/ingest-order.ts auth pattern.
// user_id is validated but NOT stored — recipe_library is a global, unattributed pool.

import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { isApproved } from "./_approved.js";

// Separate from normalizeIngName (src/lib/normalize.ts) and normalized_product (ingest-order.ts).
// Deterministic: lowercase, strip punctuation, collapse whitespace.
function normalizeRecipeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function computeContentHash(name: string, ingredients: any[], steps: any[]): string {
  const normalizedName = normalizeRecipeName(name);
  const ingNames = ingredients
    .map((i: any) => normalizeRecipeName(String(i.name || "")))
    .filter(Boolean)
    .sort()
    .join(",");
  const stepsStr = steps.map((s: any) => String(s || "").trim()).join("|");
  return createHash("sha256")
    .update(`${normalizedName}|${ingNames}|${stepsStr}`)
    .digest("hex");
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

  // Validate JWT — recipe_library is global so user_id is not stored,
  // but saves are gated to authenticated users.
  const authHeader = (req.headers["authorization"] as string) ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const anonClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: userData, error: authError } = await anonClient.auth.getUser(token);
  if (authError || !userData.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const approved = await isApproved(token, userData.user.id);
  if (!approved) { res.status(403).json({ error: "Account pending approval" }); return; }

  let body: any;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const { name, cuisine, servings, difficulty, estKcalPerServing, steps, ingredients, model } = body;

  if (!name || !Array.isArray(ingredients) || !Array.isArray(steps)) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const contentHash = computeContentHash(name, ingredients, steps);
  const normalizedRecipe =
    `${normalizeRecipeName(name)}|${(cuisine ?? "").toLowerCase().trim()}`;

  const svc = createClient(supabaseUrl, serviceRoleKey);

  const { error } = await svc.from("recipe_library").upsert(
    {
      content_hash:      contentHash,
      normalized_recipe: normalizedRecipe,
      name:              String(name).trim(),
      cuisine:           cuisine ? String(cuisine).trim() : null,
      dietary_tags:      [],
      ingredients:       ingredients,
      steps:             steps,
      nutrition:         estKcalPerServing ? { kcalPerServing: estKcalPerServing } : null,
      difficulty:        typeof difficulty === "number" ? difficulty : null,
      servings:          typeof servings === "number" ? servings : null,
      base_recipe_id:    null,
      times_reused:      0,
      active:            true,
      source:            "generated",
      model:             model ?? "claude-sonnet-4-6",
      recipe_json:       body,
    },
    { onConflict: "content_hash", ignoreDuplicates: true },
  );

  if (error) {
    console.error("recipe_library upsert failed:", error.message);
    res.status(500).json({ error: "Failed to save recipe" });
    return;
  }

  res.status(200).json({ ok: true });
}
