import { AlertCircle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { LIFECYCLE_BADGE_CLASSES, LIFECYCLE_LABELS, classifyLifecycle } from "@/lib/lifecycle";
import type { AdminUser, FeedbackItem } from "@/lib/types";

type UserDrillDownPanelProps = {
  user: AdminUser;
  feedback: FeedbackItem[];
  feedbackLoading: boolean;
  feedbackError: string;
  busy: boolean;
  onClose: () => void;
  onApprove: (userId: string) => void;
  onReject: (userId: string, email: string) => void;
  onGrantQual: (userId: string, email: string) => void;
};

// TER-511: per-user drill-down — profile + engagement + feedback + qualification
// slot. A slide-over panel, same fixed/backdrop pattern as the AdminShell nav drawer.
export default function UserDrillDownPanel({
  user,
  feedback,
  feedbackLoading,
  feedbackError,
  busy,
  onClose,
  onApprove,
  onReject,
  onGrantQual,
}: UserDrillDownPanelProps) {
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;
  const lifecycle = classifyLifecycle(user);
  const acceptRate =
    user.recipes_generated > 0 ? `${Math.round((user.dinners_accepted / user.recipes_generated) * 100)}%` : "—";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="animate-in slide-in-from-right fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-card duration-200">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-foreground">{displayName}</h3>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-6 px-5 py-5">
          <div className="flex flex-wrap gap-2">
            <Badge variant={user.approved ? "success" : "warning"}>{user.approved ? "Approved" : "Pending"}</Badge>
            <Badge className={LIFECYCLE_BADGE_CLASSES[lifecycle]}>{LIFECYCLE_LABELS[lifecycle]}</Badge>
            {user.qualified && <Badge variant="success">Qualified #{user.qualification_slot}</Badge>}
          </div>

          <section>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Profile</h4>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Signed up</dt>
              <dd className="text-foreground">{formatDate(user.created_at)}</dd>
              <dt className="text-muted-foreground">Last active</dt>
              <dd className="text-foreground">{formatDate(user.last_active)}</dd>
              <dt className="text-muted-foreground">Source</dt>
              <dd className="text-foreground">{user.signup_source ?? "—"}</dd>
            </dl>
          </section>

          <section>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Engagement</h4>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Recipes generated</dt>
              <dd className="text-foreground">{user.recipes_generated}</dd>
              <dt className="text-muted-foreground">Dinners accepted</dt>
              <dd className="text-foreground">{user.dinners_accepted}</dd>
              <dt className="text-muted-foreground">Accept rate</dt>
              <dd className="text-foreground">{acceptRate}</dd>
              <dt className="text-muted-foreground">Feedback submitted</dt>
              <dd className="text-foreground">{user.feedback_count}</dd>
            </dl>
          </section>

          <section>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Feedback</h4>
            {feedbackLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!feedbackLoading && feedbackError && (
              <p className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertCircle size={14} /> {feedbackError}
              </p>
            )}
            {!feedbackLoading && !feedbackError && feedback.length === 0 && (
              <p className="text-sm text-muted-foreground">No feedback submitted.</p>
            )}
            <div className="flex flex-col gap-2">
              {feedback.map((fb) => (
                <div key={fb.id} className="rounded-md border border-border p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">{fb.category ?? "other"}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(fb.created_at)}</span>
                  </div>
                  <p className="text-sm text-foreground">{fb.message}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Actions</h4>
            {!user.approved && (
              <div className="flex gap-2">
                <Button className="flex-1" disabled={busy} onClick={() => onApprove(user.id)}>
                  {busy ? "…" : "Approve"}
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => onReject(user.id, user.email)}
                >
                  Reject
                </Button>
              </div>
            )}
            {user.approved && !user.qualified && (
              <Button variant="secondary" disabled={busy} onClick={() => onGrantQual(user.id, user.email)}>
                {busy ? "…" : "Grant qualification"}
              </Button>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
