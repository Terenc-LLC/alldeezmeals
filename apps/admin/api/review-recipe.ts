// TER-357: Approve or reject a pending recipe. Reject is NOT delete — row retained for analytics.
import { createClient } from "@supabase/supabase-js";
import { getAuthedUser } from "./_admin.js";

const VALID_CATEGORIES = [
  "not_original", "bad_instructions", "implausible_ingredients",
  "duplicate", "unappetizing", "format_error", "other",
] as const;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const auth = await getAuthedUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!auth.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }

  let body: any;
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { res.status(400).json({ error: "Invalid JSON" }); return; }

  const { id, decision, category, reason } = body ?? {};

  if (!id || !["approve", "reject"].includes(decision)) {
    res.status(400).json({ error: "id and decision (approve|reject) required" }); return;
  }
  if (decision === "reject" && !VALID_CATEGORIES.includes(category)) {
    res.status(400).json({ error: `rejection_category required on reject; valid: ${VALID_CATEGORIES.join(", ")}` }); return;
  }

  const url = process.env.VITE_SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const svc = createClient(url, svcKey);

  const now = new Date().toISOString();
  const update = decision === "approve"
    ? { active: true, review_status: "approved", reviewed_at: now, reviewed_by: auth.user.id }
    : {
        active: false,
        review_status: "rejected",
        rejection_category: category,
        rejection_reason: reason ? String(reason).slice(0, 1000) : null,
        reviewed_at: now,
        reviewed_by: auth.user.id,
      };

  const { error } = await svc
    .from("recipe_library")
    .update(update)
    .eq("id", id)
    .eq("review_status", "pending");

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(200).json({ ok: true });
}
