// TER-355: admin-granted qualification (replaces self-serve /api/qualify)
import { createClient } from "@supabase/supabase-js";
import { getAuthedUser } from "../_admin.js";
import { sendResendEmail, htmlEscape } from "../_email.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const auth = await getAuthedUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!auth.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }

  let body: any;
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { res.status(400).json({ error: "Invalid JSON" }); return; }

  const { email } = body ?? {};
  if (typeof email !== "string" || !email.trim()) {
    res.status(400).json({ error: "email required" }); return;
  }

  const url = process.env.VITE_SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const svc = createClient(url, svcKey);

  const { data: profile } = await svc
    .from("profiles")
    .select("id, email, first_name, name")
    .ilike("email", email.trim())
    .maybeSingle();

  if (!profile) {
    res.status(404).json({ error: "No user with that email" }); return;
  }

  const { data: existing } = await svc
    .from("qualifications")
    .select("qualification_number")
    .eq("user_id", profile.id)
    .maybeSingle();

  if (existing) {
    res.status(200).json({ alreadyQualified: true, number: existing.qualification_number }); return;
  }

  const { data: claimedNumber } = await svc.rpc("claim_qualification", { uid: profile.id });

  if (claimedNumber === null) {
    res.status(200).json({ capReached: true }); return;
  }

  const n = claimedNumber as number;
  const to = profile.email as string;
  const firstName = htmlEscape(profile.first_name ?? profile.name?.split(" ")[0] ?? "there");

  // TER-429 (M-7): await the send — a fire-and-forget call can be frozen when the
  // lambda ends, silently dropping the email. The try/catch keeps a send failure
  // from blocking the success response or the committed qualification.
  try {
    await sendResendEmail({
      to,
      subject: `Your ALLDEEZMeals beta spot is confirmed (#${n} of 50)`,
      headers: { "List-Unsubscribe": "<mailto:alldeezmeals@terenc.com?subject=unsubscribe>" },
      html: `<p>Hi ${firstName},</p><p>Thanks for testing ALLDEEZMeals and sharing your feedback — you're qualifier #${n} of 50, which locks in a full year of ALLDEEZMeals free once the paid plan launches.</p><p>Nothing to do right now; I'll be in touch as the beta develops.</p><p>— Chris<br>ALLDEEZMeals</p>`,
    });
  } catch { /* intentional: email failure must not affect the response */ }

  res.status(200).json({ qualified: true, number: n });
}
