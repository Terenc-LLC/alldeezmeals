// Shared approval-gate helper. Underscore prefix => not a Vercel route.
import { createClient } from "@supabase/supabase-js";

// True only if the user's profile is approved. Fail-closed on any error.
// Uses a user-context client (token forwarded) so the "read own profile"
// RLS policy applies — a bare anon client reads as anon and returns nothing.
export async function isApproved(token: string, userId: string): Promise<boolean> {
  const url  = process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;
  const client = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client
    .from("profiles").select("approved").eq("id", userId).single();
  if (error || !data) return false;
  return data.approved === true;
}
