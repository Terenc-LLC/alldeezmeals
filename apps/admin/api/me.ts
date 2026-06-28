// TER-520: server-side admin gate for the admin app. Verifies the Bearer JWT
// (anon client) and checks ADMIN_EMAILS. The allowlist is never bundled to the
// client. Mirrors the consumer's api/me.ts shape, minus the profiles/qualification
// read (not needed for the skeleton).
import { getAuthedUser } from "./_admin.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  const auth = await getAuthedUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }

  res.status(200).json({
    email: auth.email,
    isAdmin: auth.isAdmin,
  });
}
