// Returns the verified user's email, admin flag, and qualification status.
import { createClient } from "@supabase/supabase-js";
import { getAuthedUser } from "./_admin.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  const auth = await getAuthedUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }

  const url = process.env.VITE_SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const svc = createClient(url, svcKey);

  const { data: profile } = await svc
    .from("profiles")
    .select("qualification_number")
    .eq("id", auth.user.id)
    .maybeSingle();

  const qualificationNumber: number | null = profile?.qualification_number ?? null;

  res.status(200).json({
    email: auth.email,
    isAdmin: auth.isAdmin,
    qualification_number: qualificationNumber,
    qualified: qualificationNumber !== null,
  });
}
