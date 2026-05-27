// Returns the verified user's email and admin flag.
// Client uses this to decide whether to show the Catalog tab.
import { getAuthedUser } from "./_admin.ts";

export default async function handler(req: any, res: any) {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  const auth = await getAuthedUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  res.status(200).json({ email: auth.email, isAdmin: auth.isAdmin });
}
