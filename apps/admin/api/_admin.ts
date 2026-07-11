// Admin/auth gate helper for the admin app's serverless functions.
// Underscore prefix => not a Vercel route.
//
// TER-510: canonical (and only) copy of the admin gate. The consumer deploy no
// longer contains any admin code; all /api/admin endpoints now live here. Bearer
// JWT verify via anon client -> ADMIN_EMAILS check; privileged ops use the
// service-role key. Imports @supabase/supabase-js only.
import { createClient } from "@supabase/supabase-js";

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

// Returns the verified user + admin flag, or null if unauthenticated/misconfigured.
export async function getAuthedUser(req: any): Promise<{ user: any; email: string; isAdmin: boolean } | null> {
  const authHeader = (req.headers["authorization"] as string) ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  const url = process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const client = createClient(url, anon);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  const email = (data.user.email ?? "").toLowerCase();
  return { user: data.user, email, isAdmin: adminEmails().includes(email) };
}
