// TER-266: beta qualification trigger endpoint
import { createClient } from "@supabase/supabase-js";
import { getAuthedUser } from "./_admin.js";
import { sendResendEmail, htmlEscape } from "./_email.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const auth = await getAuthedUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }

  const userId = auth.user.id as string;
  const url = process.env.VITE_SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const svc = createClient(url, svcKey);

  // Check if already qualified — return early without resending email
  const { data: existing } = await svc
    .from("qualifications")
    .select("qualification_number")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    res.status(200).json({ qualified: true, number: existing.qualification_number, alreadyQualified: true });
    return;
  }

  // Atomic claim
  const { data: claimedNumber, error: rpcErr } = await svc.rpc("claim_qualification", { uid: userId });
  if (rpcErr) { res.status(500).json({ error: rpcErr.message }); return; }

  if (claimedNumber === null) {
    res.status(200).json({ qualified: false, capReached: true });
    return;
  }

  // Best-effort confirmation email — never throws, never blocks response
  (async () => {
    try {
      const { data: profile } = await svc
        .from("profiles")
        .select("email, first_name, name")
        .eq("id", userId)
        .maybeSingle();
      const to = profile?.email ?? auth.email;
      const firstName = htmlEscape(profile?.first_name ?? profile?.name?.split(" ")[0] ?? "there");
      const n = claimedNumber as number;
      await sendResendEmail({
        to,
        subject: `You're in — 1 year free locked in (#${n} of 50)`,
        html: `<p>Hi ${firstName},</p>
<p>You just locked in your spot — you're qualifier #${n} of 50, which means a full year of ALLDEEZMeals free once beta ends.</p>
<p>Nothing to do right now: keep planning your weeks and handing off your ALDI list. I'll be in touch as the beta develops.</p>
<p>Thanks for being one of the first.</p>
<p>— Chris<br>ALLDEEZMeals</p>`,
      });
    } catch { /* intentional: email failure must not affect the response */ }
  })();

  res.status(200).json({ qualified: true, number: claimedNumber, alreadyQualified: false });
}
