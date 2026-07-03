import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { supabase } from "@terenc/shared/supabase";
import { Button } from "@/components/ui/button";
import SignInView from "./SignInView";
import Approvals from "./Approvals";

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  // isAdmin is resolved server-side (/api/me reads ADMIN_EMAILS, never bundled
  // to the client). null = not yet resolved.
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoaded(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.access_token) { setIsAdmin(null); return; }
    let cancelled = false;
    setIsAdmin(null);
    fetch("/api/me", { headers: { authorization: `Bearer ${session.access_token}` } })
      .then((r) => (r.ok ? r.json() : { isAdmin: false }))
      .then((d) => { if (!cancelled) setIsAdmin(!!d.isAdmin); })
      .catch(() => { if (!cancelled) setIsAdmin(false); });
    return () => { cancelled = true; };
  }, [session?.access_token]);

  const signOut = () => supabase.auth.signOut();

  if (!authLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!session) return <SignInView />;

  // Signed in, gate result pending.
  if (isAdmin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Checking access…
      </div>
    );
  }

  // Signed in but not an admin.
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-center">
          <ShieldAlert className="mx-auto text-destructive" size={28} />
          <h1 className="mt-2 text-lg font-semibold text-foreground">Not authorized</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {session.user?.email} is not an admin account.
          </p>
          <Button variant="secondary" onClick={signOut} className="mt-4 w-full">
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  // Admin shell — empty base every Phase 1 section fills.
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-3">
        <h1 className="text-lg font-semibold text-foreground">
          ALLDEEZ<span className="text-primary">Meals</span> Admin
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{session.user?.email}</span>
          <Button variant="ghost" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <h2 className="mb-4 text-base font-semibold text-foreground">Pending approvals</h2>
        <Approvals session={session} />
      </main>
    </div>
  );
}
