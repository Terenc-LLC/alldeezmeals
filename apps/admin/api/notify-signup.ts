// TER-238: Supabase Database Webhook — fires on profiles INSERT.
// Verifies x-webhook-secret header, then sends a Resend email to the admin.
// No user auth here — caller is Supabase's webhook service.
import { sendResendEmail } from "./_email.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const secret = process.env.WEBHOOK_SECRET;
  const incoming = req.headers["x-webhook-secret"] as string | undefined;
  if (!secret || incoming !== secret) {
    res.status(401).json({ error: "Unauthorized" }); return;
  }

  let body: any;
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { res.status(400).json({ error: "Invalid JSON" }); return; }

  const record = body?.record ?? {};
  const email = record.email ?? "(no email)";
  const name = record.name ?? "(no name)";
  const nearest_aldi = record.nearest_aldi ?? "(not provided)";
  const reason = record.reason ?? "(not provided)";
  const signup_source = record.signup_source ?? "(not provided)";
  const first_name = record.first_name || String(record.name ?? "").split(" ")[0] || "there";
  const requested_at = record.requested_at
    ? new Date(record.requested_at).toLocaleString("en-US", { timeZone: "UTC" }) + " UTC"
    : "(unknown)";

  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.ALERT_FROM_EMAIL;
  const toEmail = process.env.ALERT_TO_EMAIL;

  if (!resendKey || !fromEmail || !toEmail) {
    console.error("notify-signup: missing RESEND_API_KEY, ALERT_FROM_EMAIL, or ALERT_TO_EMAIL");
    res.status(500).json({ error: "Email not configured" }); return;
  }

  try {
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: toEmail,
        subject: `New ALLDEEZMeals signup: ${email}`,
        html: `
<p><strong>New signup awaiting approval</strong></p>
<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-family:sans-serif;font-size:14px;">
  <tr><th align="left">Name</th><td>${htmlEscape(name)}</td></tr>
  <tr><th align="left">Email</th><td>${htmlEscape(email)}</td></tr>
  <tr><th align="left">Nearest ALDI</th><td>${htmlEscape(nearest_aldi)}</td></tr>
  <tr><th align="left">Reason</th><td>${htmlEscape(reason)}</td></tr>
  <tr><th align="left">Signup source</th><td>${htmlEscape(signup_source)}</td></tr>
  <tr><th align="left">Requested at</th><td>${htmlEscape(requested_at)}</td></tr>
</table>
<p><a href="https://alldeezmeals.com">Go to ALLDEEZMeals admin queue</a></p>
`.trim(),
      }),
    });

    if (!emailRes.ok) {
      const text = await emailRes.text();
      console.error("notify-signup: Resend error", emailRes.status, text);
      res.status(500).json({ error: `Resend error ${emailRes.status}` }); return;
    }

    await sendResendEmail({
      to: record.email,
      subject: "Your ALLDEEZMeals request is in",
      headers: { "List-Unsubscribe": "<mailto:alldeezmeals@terenc.com?subject=unsubscribe>" },
      html: `
<p>Hi ${htmlEscape(first_name)},</p>
<p>Thanks for requesting access to ALLDEEZMeals — the ALDI-first weekly dinner planner.</p>
<p>Your request is in and waiting on a quick review (I'm onboarding testers in small batches).
I'll email you the moment you're approved so you can jump straight in.</p>
<p>— Chris<br>ALLDEEZMeals</p>`.trim(),
    });

    res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("notify-signup: fetch failed", err);
    res.status(500).json({ error: err?.message ?? "Network error" });
  }
}

function htmlEscape(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
