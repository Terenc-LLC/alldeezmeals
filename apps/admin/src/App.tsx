import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { supabase } from "@terenc/shared/supabase";
import { Button } from "@/components/ui/button";
import SignInView from "./SignInView";
import AdminShell from "./AdminShell";
import Dashboard from "./routes/Dashboard";
import Insights from "./routes/Insights";
import ApprovalsPage from "./routes/ApprovalsPage";
import ReviewQueues from "./routes/ReviewQueues";
import Users from "./routes/Users";
import Catalog from "./routes/Catalog";
import Beta from "./routes/Beta";
import Feedback from "./routes/Feedback";
import Tools from "./routes/Tools";

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

  // Admin shell — IA routes every Phase 1 section fills (TER-509).
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AdminShell email={session.user?.email} onSignOut={signOut} />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/approvals" element={<ApprovalsPage session={session} />} />
          <Route path="/review-queues" element={<ReviewQueues session={session} />} />
          <Route path="/users" element={<Users session={session} />} />
          <Route path="/catalog" element={<Catalog session={session} />} />
          <Route path="/beta" element={<Beta session={session} />} />
          <Route path="/feedback" element={<Feedback session={session} />} />
          <Route path="/tools" element={<Tools session={session} />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
