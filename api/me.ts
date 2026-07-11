// Returns the verified user's email and qualification status.
// TER-510: the consumer deploy contains zero admin code — this endpoint no
// longer imports the admin gate (api/_admin.ts is gone) and no longer returns
// `isAdmin`. It inlines a plain Bearer-JWT verify (anon client), mirroring the
// pattern in api/generate.ts. `qualification_number`/`qualified` are still
// consumed by the user app and are preserved.
import { createClient } from "@supabase/supabase-js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  const authHeader = (req.headers["authorization"] as string) ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }

  const url = process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) { res.status(500).json({ error: "Server misconfigured" }); return; }

  const anonClient = createClient(url, anon);
  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data.user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const email = (data.user.email ?? "").toLowerCase();

  const svc = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: profile } = await svc
    .from("profiles")
    .select("qualification_number")
    .eq("id", data.user.id)
    .maybeSingle();

  const qualificationNumber: number | null = profile?.qualification_number ?? null;

  res.status(200).json({
    email,
    qualification_number: qualificationNumber,
    qualified: qualificationNumber !== null,
  });
}
