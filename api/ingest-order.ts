// TER-186: Server-side order/receipt ingestion.
// TER-202: Dedup key changed to normalized_product; added orderDate for purchase timestamps.
// TER-237: Catalog writes now gated behind admin approval. Submit → receipt_submissions queue
//          + immediate item_usage update. Catalog upsert moved to api/admin/approve-submission.ts.
// user_id is derived from the validated JWT — never from client-supplied input.

import { createClient } from "@supabase/supabase-js";
import { normalizeIngName } from "../src/lib/normalize.ts";
import { isApproved } from "./_approved.js";

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

function toNormalizedProduct(productName: string | null | undefined, fallback: string): string {
  return ((productName?.trim() || fallback.trim()) || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
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

  const approved = await isApproved(token, userId);
  if (!approved) { res.status(403).json({ error: "Account pending approval" }); return; }

  let body: { rows?: IngestRow[]; orderDate?: string };
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

  // Resolve purchase date from the receipt's orderDate; fall back to now().
  // Noon UTC avoids date-shifting when displayed in non-UTC timezones.
  const now = new Date().toISOString();
  const rawOrderDate = typeof body.orderDate === "string" ? body.orderDate.trim() : "";
  let purchaseDate = now;
  if (rawOrderDate) {
    const d = new Date(rawOrderDate);
    if (!isNaN(d.getTime())) {
      purchaseDate = rawOrderDate.slice(0, 10) + "T12:00:00.000Z";
    }
  }

  // Dedupe within the submitted batch by normalized_product (last-wins on size/price).
  // This collapses same-product rows that got different generic names from the LLM
  // (e.g. "lunch mate hard salami" and "hard salami" → one row for Lunch Mate Hard Salami).
  const seenProducts = new Map<string, IngestRow>();
  for (const row of deliveredRows) {
    const key = toNormalizedProduct(row.productName, row.normalizedName);
    seenProducts.set(key, row);
  }

  // Service role client: bypasses RLS so we can write to per-user item_usage.
  const svc = createClient(supabaseUrl, serviceRoleKey);

  // Build the submission rows payload (normalized, validated).
  const submitterEmail = (userData.user.email ?? "").toLowerCase();
  const submissionRows = Array.from(seenProducts.entries()).map(([normalizedProduct, row]) => ({
    normalizedProduct,
    normalizedName: normalizeIngName(row.normalizedName),
    productName: row.productName?.trim() || null,
    brand: row.brand?.trim() || null,
    category: VALID_CATEGORIES.includes(row.category ?? "") ? row.category : null,
    packageSize: row.packageSize?.trim() || null,
    upc: row.upc?.trim() || null,
    unitPriceCents: typeof row.unitPriceCents === "number" ? Math.round(row.unitPriceCents) : null,
    qty: Math.max(1, Math.round(Number(row.qty) || 1)),
  }));

  // Insert into receipt_submissions queue. Catalog is NOT touched until an admin approves.
  const { data: subRow, error: subErr } = await svc
    .from("receipt_submissions")
    .insert({
      submitter_user_id: userId,
      submitter_email: submitterEmail,
      order_date: rawOrderDate ? rawOrderDate.slice(0, 10) : null,
      rows: submissionRows,
    })
    .select("id")
    .single();
  if (subErr) {
    console.error("receipt_submissions insert failed:", subErr.message);
    res.status(500).json({ error: "Failed to queue submission" });
    return;
  }

  // Update item_usage immediately (per-user purchase history — not gated by admin approval).
  // catalog_id is left null for now; approve-submission.ts backfills it after catalog upsert.
  const failed: string[] = [];
  for (const row of submissionRows) {
    const { normalizedProduct, qty } = row;
    try {
      const { data: existing } = await svc
        .from("item_usage")
        .select("id, purchase_count")
        .eq("user_id", userId)
        .eq("item_name", normalizedProduct)
        .maybeSingle();

      if (existing) {
        const { error: updateErr } = await svc
          .from("item_usage")
          .update({
            purchase_count: existing.purchase_count + qty,
            last_purchased_at: purchaseDate,
          })
          .eq("id", existing.id);

        if (updateErr) {
          console.error("item_usage update failed:", normalizedProduct, updateErr.message);
          failed.push(normalizedProduct);
        }
      } else {
        const { error: insertErr } = await svc.from("item_usage").insert({
          user_id: userId,
          catalog_id: null,
          item_name: normalizedProduct,
          purchase_count: qty,
          last_purchased_at: purchaseDate,
        });

        if (insertErr) {
          console.error("item_usage insert failed:", normalizedProduct, insertErr.message);
          failed.push(normalizedProduct);
        }
      }
    } catch (e: any) {
      console.error("item_usage row error:", normalizedProduct, e?.message);
      failed.push(normalizedProduct);
    }
  }

  res.status(200).json({
    submissionId: subRow.id,
    status: "pending",
    itemsCount: submissionRows.length,
    ...(failed.length > 0 ? { usageFailures: failed.length } : {}),
  });
}
