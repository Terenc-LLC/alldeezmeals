// TER-186: Server-side order/receipt ingestion.
// Upserts shared catalog + per-user item_usage via the service role.
// user_id is derived from the validated JWT — never from client-supplied input.

import { createClient } from "@supabase/supabase-js";

const VALID_CATEGORIES = [
  "Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry", "Frozen", "Bakery", "Other",
];

type IngestRow = {
  normalizedName: string;
  productName?: string | null;
  brand?: string | null;
  category?: string | null;
  packageSize?: string | null;
  qty?: number | null;
  unitPriceCents?: number | null;
  upc?: string | null;
  isRefund?: boolean;
  include?: boolean;
};

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

  // Validate JWT; derive user_id from the server-validated token — never from client input.
  // The service role bypasses RLS, so ownership enforcement lives here, not in the database.
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
  const userId = userData.user.id;

  let body: { rows?: IngestRow[] };
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  const allRows: IngestRow[] = Array.isArray(body.rows) ? body.rows : [];

  // Key off delivered items only: skip refunds and rows the user excluded in the review table.
  const deliveredRows = allRows.filter(
    (r) =>
      !r.isRefund &&
      r.include !== false &&
      typeof r.normalizedName === "string" &&
      r.normalizedName.trim().length > 0,
  );

  if (deliveredRows.length === 0) {
    res.status(400).json({ error: "No delivered items to ingest" });
    return;
  }

  // Service role client: bypasses RLS so we can write to the shared catalog.
  const svc = createClient(supabaseUrl, serviceRoleKey);

  const ok: string[] = [];
  const failed: string[] = [];
  const now = new Date().toISOString();

  for (const row of deliveredRows) {
    const normalized = row.normalizedName.trim().toLowerCase();
    const category = VALID_CATEGORIES.includes(row.category ?? "")
      ? (row.category as string)
      : null;
    const purchaseQty = Math.max(1, Math.round(Number(row.qty) || 1));

    try {
      // Upsert catalog keyed on normalized_name.
      // Only non-nutrition columns are specified here — nutrition columns stay untouched on conflict.
      const { data: catalogRow, error: catalogErr } = await svc
        .from("catalog")
        .upsert(
          {
            normalized_name: normalized,
            product_name: row.productName?.trim() || null,
            brand: row.brand?.trim() || null,
            category,
            package_size: row.packageSize?.trim() || null,
            upc: row.upc?.trim() || null,
            last_price_cents:
              typeof row.unitPriceCents === "number"
                ? Math.round(row.unitPriceCents)
                : null,
            last_seen_at: now,
            source: "receipt",
            updated_at: now,
          },
          { onConflict: "normalized_name" },
        )
        .select("id")
        .single();

      if (catalogErr) {
        console.error("catalog upsert failed:", normalized, catalogErr.message);
        failed.push(normalized);
        continue;
      }

      const catalogId: string | null = catalogRow?.id ?? null;

      // Upsert item_usage: increment purchase_count on conflict rather than overwriting.
      const { data: existing } = await svc
        .from("item_usage")
        .select("id, purchase_count")
        .eq("user_id", userId)
        .eq("item_name", normalized)
        .maybeSingle();

      if (existing) {
        const { error: updateErr } = await svc
          .from("item_usage")
          .update({
            purchase_count: existing.purchase_count + purchaseQty,
            last_purchased_at: now,
            ...(catalogId ? { catalog_id: catalogId } : {}),
          })
          .eq("id", existing.id);

        if (updateErr) {
          console.error("item_usage update failed:", normalized, updateErr.message);
          failed.push(normalized);
          continue;
        }
      } else {
        const { error: insertErr } = await svc.from("item_usage").insert({
          user_id: userId,
          catalog_id: catalogId,
          item_name: normalized,
          purchase_count: purchaseQty,
          last_purchased_at: now,
        });

        if (insertErr) {
          console.error("item_usage insert failed:", normalized, insertErr.message);
          failed.push(normalized);
          continue;
        }
      }

      ok.push(normalized);
    } catch (e: any) {
      console.error("ingest row error:", normalized, e?.message);
      failed.push(normalized);
    }
  }

  res.status(200).json({
    ingested: ok.length,
    failed: failed.length,
    ...(failed.length > 0 ? { failedItems: failed } : {}),
  });
}
