// TER-238: Approve a pending user — flips profiles.approved to true.
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
  const { userId } = body ?? {};
  if (typeof userId !== "string" || !userId) {
    res.status(400).json({ error: "userId required" }); return;
  }

  const url = process.env.VITE_SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const svc = createClient(url, svcKey);

  const { data: prof, error } = await svc
    .from("profiles")
    .update({ approved: true, approved_at: new Date().toISOString(), approved_by: auth.email })
    .eq("id", userId)
    .select("email, first_name, referral_code")
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }

  if (prof?.email) {
    const firstName = prof.first_name || "there";
    const code = prof.referral_code;
    const inviteBlock = code
      ? `<p>One of the perks of being in this early group: you've got <strong>2 invites</strong>
to share. Send a friend or two your personal link — beta spots are limited, so spend them on
people who'll actually cook:<br>
<a href="https://alldeezmeals.com/${code}">https://alldeezmeals.com/${htmlEscape(code)}</a></p>`
      : "";
    await sendResendEmail({
      to: prof.email,
      subject: "Your ALLDEEZMeals account is ready",
      headers: { "List-Unsubscribe": "<mailto:alldeezmeals@terenc.com?subject=unsubscribe>" },
      html: `
<p>Hi ${htmlEscape(firstName)},</p>
<p>Good news — your account is approved and ready to go.</p>
<p>Head to <a href="https://alldeezmeals.com">alldeezmeals.com</a> and enter your email. You'll
get a one-time sign-in link by email (no passwords here) — click it and you're in. From there,
set up your week, let it build an ALDI dinner plan, and hand off the grocery list.</p>
${inviteBlock}
<p>Thanks for helping test this — if anything feels off, there's a feedback option right in the app.</p>
<p>— Chris<br>ALLDEEZMeals</p>`.trim(),
    });
  }
  res.status(200).json({ ok: true });
}
