// TER-493: Lazy-pull nutrition (Calories + macros) for a recipe ingredient by
// representative catalog UPC, persisting the hit onto the catalog row so it's
// cached for everyone. Runs for ANY approved user (the resolver calls it on a
// catalog nutrition gap) — NOT admin-gated, unlike the admin-only
// apps/admin/api/catalog-nutrition.ts (relocated out of the consumer in TER-510).
// Service-role for the catalog write (catalog RLS has no JWT write policy).
//
// Locked decision (founder 2026-06-26): mapping a generic recipe ingredient to a
// representative product is nutrition-neutral for raw ingredients (kcal/macros are
// per-100g), so we do NOT rank UPCs by item_usage or package_size — we just try
// rows by id ascending until one GTIN resolves.

import { createClient } from "@supabase/supabase-js";
import { normalizeGtin, gtinDigits } from "../src/lib/normalize.js";
import { isApproved } from "./_approved.js";
import { lookupByGtin } from "./_nutritionLookup.js";

// Max UPC-bearing rows to probe before giving up (bounds FDC/OFF fan-out per call).
const MAX_UPC_PROBES = 8;

// Derive a serving gram weight from a serving_basis string like "240g" or "1serving".
// Mirrors apps/admin/api/catalog-nutrition.ts auto-mode exactly.
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
  const fdcKey = process.env.FDC_API_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey || !fdcKey) {
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

  // Approval gate (NOT admin) — any approved user triggers a lazy populate.
  const approved = await isApproved(token, userData.user.id);
  if (!approved) {
    res.status(403).json({ error: "Account pending approval" });
    return;
  }

  let body: { normalizedName?: string };
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const normalizedName = typeof body.normalizedName === "string" ? body.normalizedName.trim() : "";
  if (!normalizedName) {
    res.status(400).json({ error: "normalizedName required" });
    return;
  }

  // Service-role client for catalog reads/writes (catalog has no JWT write policy).
  const svc = createClient(supabaseUrl, serviceRoleKey);

  const { data: rows, error: selErr } = await svc
    .from("catalog")
    .select("id, upc, kcal_per_100g, serving_g, macros, nutrition_source")
    .eq("normalized_name", normalizedName)
    .order("id", { ascending: true });

  if (selErr) {
    console.error("catalog-nutrition-pull select failed:", normalizedName, selErr.message);
    res.status(500).json({ error: "Failed to read catalog" });
    return;
  }

  const catalogRows = rows ?? [];

  // 1. Already populated under this normalized_name → use it; no external call.
  const existing = catalogRows.find((r: any) => r.kcal_per_100g != null);
  if (existing) {
    res.status(200).json({
      hit: true,
      kcal_per_100g: existing.kcal_per_100g,
      macros: existing.macros ?? null,
      serving_g: existing.serving_g ?? null,
      source: existing.nutrition_source ?? null,
    });
    return;
  }

  // 2. Try UPC-bearing rows by id ascending until one GTIN resolves, then persist.
  const upcRows = catalogRows
    .filter((r: any) => typeof r.upc === "string" && r.upc.trim() !== "")
    .slice(0, MAX_UPC_PROBES);

  for (const row of upcRows) {
    let outcome;
    try {
      outcome = await lookupByGtin(gtinDigits(row.upc), normalizeGtin(row.upc), fdcKey);
    } catch (e: any) {
      console.error("catalog-nutrition-pull lookup threw:", row.upc, e?.message);
      continue;
    }
    if (outcome.status !== "hit") continue;

    const data = outcome.data;
    const serving_g = servingGFromBasis(data.serving_basis);
    const now = new Date().toISOString();
    const update = {
      kcal_per_100g: data.kcal_per_100g,
      serving_g,
      macros: data.macros ?? null,
      fdc_id: data.fdcId != null ? String(data.fdcId) : null,
      nutrition_source: data.source,
      nutrition_retrieved_at: now,
      nutrition_stale: false,
      updated_at: now,
    };

    const { error: updErr } = await svc.from("catalog").update(update).eq("id", row.id);
    if (updErr) {
      console.error("catalog-nutrition-pull update failed:", row.id, updErr.message);
      res.status(500).json({ error: "Failed to persist catalog nutrition" });
      return;
    }

    res.status(200).json({
      hit: true,
      kcal_per_100g: data.kcal_per_100g,
      macros: data.macros ?? null,
      serving_g,
      source: data.source,
    });
    return;
  }

  // 3. No UPC resolved (or no UPC rows) → caller falls through to the USDA name path.
  res.status(200).json({ hit: false });
}
