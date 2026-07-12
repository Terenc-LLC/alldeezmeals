// TER-266: list beta-qualified users for admin
import { createClient } from "@supabase/supabase-js";
import { getAuthedUser } from "./_admin.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  const auth = await getAuthedUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!auth.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }

  const url = process.env.VITE_SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const svc = createClient(url, svcKey);

  const [qualResult, counterResult, referredCounts] = await Promise.all([
    svc
      .from("qualifications")
      .select("qualification_number, qualified_at, profiles(email, name, referral_code)")
      .order("qualification_number", { ascending: true }),
    svc
      .from("qualification_counter")
      .select("count")
      .eq("id", 1)
      .maybeSingle(),
    // TER-514: referral signal — count signups attributed to each referral_code.
    svc.from("profiles").select("referred_by").not("referred_by", "is", null),
  ]);

  if (qualResult.error) { res.status(500).json({ error: qualResult.error.message }); return; }

  // referred_by stores the referrer's referral_code (see migration 20260604_013).
  const referredCountByCode = new Map<string, number>();
  for (const row of referredCounts.data ?? []) {
    const code = (row as any).referred_by;
    if (!code) continue;
    referredCountByCode.set(code, (referredCountByCode.get(code) ?? 0) + 1);
  }

  const users = (qualResult.data ?? []).map((row: any) => {
    const referralCode: string | null = row.profiles?.referral_code ?? null;
    return {
      qualification_number: row.qualification_number,
      qualified_at: row.qualified_at,
      email: row.profiles?.email ?? null,
      name: row.profiles?.name ?? null,
      referral_code: referralCode,
      referred_signups: referralCode ? (referredCountByCode.get(referralCode) ?? 0) : 0,
    };
  });

  res.status(200).json({
    users,
    counter: counterResult.data?.count ?? 0,
  });
}
