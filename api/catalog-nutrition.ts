// TER-195b: Persist nutrition data to a catalog row.
// Requires service-role key — catalog has RLS with no JWT write policy.
// Two modes:
//   "auto"   — client supplies the NutritionResult from /api/nutrition; we persist it.
//   "manual" — client supplies raw field values; persisted with nutrition_source = "manual".

import { createClient } from "@supabase/supabase-js";
import { adminEmails } from "./_admin.ts";

type AutoResult = {
  kcal_per_100g: number;
  serving_basis?: string;
  macros?: { protein_g: number; fat_g: number; carbs_g: number };
  fdcId?: string | number;
  source: "usda" | "off";
};

function servingGFromBasis(basis: string | undefined): number | null {
  if (!basis) return null;
  const m = basis.match(/(\d+(?:\.\d+)?)\s*g\b/);
  return m ? parseFloat(m[1]) : null;
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

  // TER-236: catalog writes are admin-only (shared catalog, service-role key).
  const callerEmail = (userData.user.email ?? "").toLowerCase();
  if (!adminEmails().includes(callerEmail)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  let body: any;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const { mode, catalogId, result: autoResult, kcal_per_100g, serving_g, macros } = body;

  if (mode !== "auto" && mode !== "manual") {
    res.status(400).json({ error: "mode must be 'auto' or 'manual'" });
    return;
  }
  if (!catalogId || typeof catalogId !== "string") {
    res.status(400).json({ error: "catalogId required" });
    return;
  }

  const now = new Date().toISOString();
  let update: Record<string, any>;

  if (mode === "auto") {
    if (!autoResult || typeof autoResult !== "object") {
      res.status(400).json({ error: "result required for auto mode" });
      return;
    }
    const r = autoResult as AutoResult;
    if (typeof r.kcal_per_100g !== "number") {
      res.status(400).json({ error: "result.kcal_per_100g must be a number" });
      return;
    }
    update = {
      kcal_per_100g: r.kcal_per_100g,
      serving_g: servingGFromBasis(r.serving_basis),
      macros: r.macros ?? null,
      fdc_id: r.fdcId != null ? String(r.fdcId) : null,
      nutrition_source: r.source,
      nutrition_retrieved_at: now,
      nutrition_stale: false,
      updated_at: now,
    };
  } else {
    const kcal = kcal_per_100g != null ? Number(kcal_per_100g) : null;
    const servingNum = serving_g != null ? Number(serving_g) : null;
    update = {
      kcal_per_100g: kcal != null && !isNaN(kcal) ? kcal : null,
      serving_g: servingNum != null && !isNaN(servingNum) ? servingNum : null,
      macros: macros ?? null,
      nutrition_source: "manual",
      nutrition_retrieved_at: now,
      nutrition_stale: false,
      updated_at: now,
    };
  }

  const svc = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await svc
    .from("catalog")
    .update(update)
    .eq("id", catalogId)
    .select("id")
    .single();

  if (error) {
    console.error("catalog-nutrition update failed:", catalogId, error.message);
    res.status(500).json({ error: "Failed to update catalog nutrition" });
    return;
  }
  if (!data) {
    res.status(404).json({ error: "Catalog row not found" });
    return;
  }

  res.status(200).json({ success: true, id: (data as any).id });
}
