// TER-513: Admin-only GTIN nutrition lookup for the Catalog "Fetch nutrition by
// UPC" action. Reuses the shared FDC/OFF lookup + nutrition_cache pattern from
// the consumer's api/nutrition.ts — no logic duplicated. The "name" mode +
// foodPortions branch (used by src/lib/nutritionResolve.ts during meal-gen)
// intentionally stays in the consumer; this endpoint only needs "gtin".
import { createClient } from "@supabase/supabase-js";
import { getAuthedUser } from "./_admin.js";
import { normalizeGtin, gtinDigits } from "../../../src/lib/normalize.js";
import { lookupByGtin, type LookupOutcome } from "../../../api/_nutritionLookup.js";

const CACHE_TTL_DAYS = 30;

type HitResponse = { hit: true } & Record<string, unknown>;
type MissResponse = { hit: false; miss_reason: string };
type CachedPayload = HitResponse | MissResponse;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const auth = await getAuthedUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!auth.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }

  const fdcKey = process.env.FDC_API_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!fdcKey || !supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }

  let body: { mode?: string; gtin?: string };
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  if (body.mode !== "gtin") {
    res.status(400).json({ error: "mode must be 'gtin'" });
    return;
  }
  const rawGtin = typeof body.gtin === "string" ? body.gtin.trim() : "";
  if (!rawGtin) {
    res.status(400).json({ error: "gtin required" });
    return;
  }

  const gtin = normalizeGtin(rawGtin);      // 14-digit canonical: cache key, FDC compare
  const offBarcode = gtinDigits(rawGtin);   // digits-only, no padding: OFF fetch URL
  const cacheKey = `upc:${gtin}`;

  // Cache client uses the caller's access token so auth.uid() resolves for RLS
  // write policies — nutrition_cache allows INSERT/UPDATE for any auth'd user.
  const authHeader = (req.headers["authorization"] as string) ?? "";
  const token = authHeader.slice(7);
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: cached } = await userClient
    .from("nutrition_cache")
    .select("result, retrieved_at")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (cached) {
    const ageMs = Date.now() - new Date(cached.retrieved_at as string).getTime();
    if (ageMs < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) {
      res.status(200).json(cached.result as CachedPayload);
      return;
    }
    // Stale — fall through to re-fetch and update.
  }

  let outcome: LookupOutcome;
  try {
    outcome = await lookupByGtin(offBarcode, gtin, fdcKey);
  } catch (e: any) {
    console.error("admin nutrition gtin lookup threw:", cacheKey, e?.message);
    outcome = { status: "error" };
  }

  const payload: CachedPayload =
    outcome.status === "hit"
      ? { hit: true, ...outcome.data }
      : outcome.status === "miss"
      ? { hit: false, miss_reason: "no_match" }
      : { hit: false, miss_reason: "upstream_error" };

  // Gate: upsert only for "hit" or "miss" — never cache "upstream_error".
  if (outcome.status !== "error") {
    try {
      const now = new Date().toISOString();
      const hitData = outcome.status === "hit" ? outcome.data : null;
      const row = {
        cache_key: cacheKey,
        result: payload,
        fdc_id: hitData?.fdcId != null ? String(hitData.fdcId) : null,
        gtin: hitData?.gtin ?? gtin,
        source: hitData?.source ?? "miss",
        retrieved_at: now,
      };
      const { error: upsertErr } = await userClient
        .from("nutrition_cache")
        .upsert(row, { onConflict: "cache_key" });
      if (upsertErr) {
        console.error("nutrition_cache upsert failed (non-fatal):", cacheKey, upsertErr.message);
      }
    } catch (e: any) {
      console.error("nutrition_cache write threw (non-fatal):", cacheKey, e?.message);
    }
  }

  res.status(200).json(payload);
}
