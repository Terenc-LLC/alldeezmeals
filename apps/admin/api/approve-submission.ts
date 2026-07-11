// TER-237: Approve a pending receipt submission — writes rows to catalog, backfills item_usage.
import { createClient } from "@supabase/supabase-js";
import { getAuthedUser } from "./_admin.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const auth = await getAuthedUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!auth.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }

  let body: any;
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { res.status(400).json({ error: "Invalid JSON" }); return; }
  const submissionId = body?.submissionId;
  if (typeof submissionId !== "string" || !submissionId) {
    res.status(400).json({ error: "submissionId required" }); return;
  }

  const url = process.env.VITE_SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const svc = createClient(url, svcKey);

  // Fetch submission, ensure pending
  const { data: sub, error: fetchErr } = await svc
    .from("receipt_submissions")
    .select("id, status, order_date, rows")
    .eq("id", submissionId).single();
  if (fetchErr || !sub) { res.status(404).json({ error: "Not found" }); return; }
  if (sub.status !== "pending") { res.status(409).json({ error: `Submission is ${sub.status}` }); return; }

  const now = new Date().toISOString();
  const purchaseDate = sub.order_date ? `${sub.order_date}T12:00:00.000Z` : now;
  const rows: any[] = Array.isArray(sub.rows) ? sub.rows : [];
  let approved = 0;
  const failed: string[] = [];

  for (const row of rows) {
    try {
      const { data: catalogRow, error: catalogErr } = await svc
        .from("catalog")
        .upsert({
          normalized_product: row.normalizedProduct,
          normalized_name: row.normalizedName,
          product_name: row.productName,
          brand: row.brand,
          category: row.category,
          package_size: row.packageSize,
          upc: row.upc,
          last_price_cents: row.unitPriceCents,
          last_seen_at: purchaseDate,
          source: "receipt",
          updated_at: now,
        }, { onConflict: "normalized_product" })
        .select("id").single();
      if (catalogErr || !catalogRow) { failed.push(row.normalizedProduct); continue; }

      // Backfill catalog_id on any item_usage row missing the link.
      await svc.from("item_usage")
        .update({ catalog_id: catalogRow.id })
        .eq("item_name", row.normalizedProduct)
        .is("catalog_id", null);

      approved++;
    } catch {
      failed.push(row.normalizedProduct);
    }
  }

  await svc.from("receipt_submissions").update({
    status: "approved",
    reviewed_at: now,
    reviewed_by_email: auth.email,
    approved_count: approved,
  }).eq("id", submissionId);

  res.status(200).json({ approved, failed: failed.length });
}
