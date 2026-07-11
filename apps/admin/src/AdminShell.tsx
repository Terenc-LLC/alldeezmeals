import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NAV_GROUPS, NAV_ITEMS } from "./nav-config";

type AdminShellProps = {
  email?: string;
  onSignOut: () => void;
};

// Desktop-first IA shell (TER-509). The nav collapses to a slide-in drawer
// below md so Approvals — the deliberate mobile-first exception (TER-508) —
// keeps its full-width card layout on phones.
export default function AdminShell({ email, onSignOut }: AdminShellProps) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            className="text-muted-foreground hover:text-foreground md:hidden"
            aria-label={navOpen ? "Close navigation" : "Open navigation"}
          >
            {navOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <h1 className="text-lg font-semibold text-foreground">
            ALLDEEZ<span className="text-primary">Meals</span> Admin
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">{email}</span>
          <Button variant="ghost" size="sm" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {navOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/30 md:hidden"
            onClick={() => setNavOpen(false)}
            aria-hidden="true"
          />
        )}

        <nav
          className={`${navOpen ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-40 w-60 shrink-0 overflow-y-auto border-r border-border bg-card px-3 py-4 transition-transform md:static md:z-auto md:flex md:translate-x-0 md:flex-col`}
        >
          {NAV_GROUPS.map((group) => {
            const items = NAV_ITEMS.filter((item) => item.group === group.id);
            if (items.length === 0) return null;
            return (
              <div key={group.id} className="mb-5">
                <p className="px-3 pb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
                <div className="flex flex-col gap-0.5">
                  {items.map(({ path, label, icon: Icon }) => (
                    <NavLink
                      key={path}
                      to={path}
                      end={path === "/"}
                      onClick={() => setNavOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                        }`
                      }
                    >
                      <Icon size={17} />
                      {label}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
