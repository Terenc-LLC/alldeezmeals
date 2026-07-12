import { useState, useRef, useEffect } from "react";
import { Share2, Copy, CheckCircle2, AlertCircle, X, RefreshCw } from "lucide-react";
import { s } from "../lib/styles";

type ShareState =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "success"; url: string; copied: boolean }
  | { phase: "error" };

// TER-534: creation success (the POST to /api/shared-recipe/create) and clipboard
// success are tracked independently — a clipboard failure must never mask a link
// that was actually created.
export default function ShareRecipeButton({ session, recipe }: { session: any; recipe: any }) {
  const [state, setState] = useState<ShareState>({ phase: "idle" });
  const wrapRef = useRef<HTMLDivElement>(null);

  const token = session?.access_token ?? "";
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const open = state.phase === "success" || state.phase === "error";

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setState({ phase: "idle" });
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  const share = async () => {
    if (!token || state.phase === "busy") return;
    setState({ phase: "busy" });
    let url: string;
    try {
      const r = await fetch("/api/shared-recipe/create", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ recipe }),
      });
      if (!r.ok) { setState({ phase: "error" }); return; }
      const data = await r.json();
      url = `${window.location.origin}${data.url}`;
    } catch {
      setState({ phase: "error" });
      return;
    }
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      copied = false;
    }
    setState({ phase: "success", url, copied });
  };

  const copyAgain = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setState({ phase: "success", url, copied: true });
    } catch {
      setState({ phase: "success", url, copied: false });
    }
  };

  const nativeShare = async (url: string) => {
    try {
      await navigator.share({ title: recipe?.name, url });
      setState({ phase: "idle" });
    } catch {
      // User cancelled the share sheet (or it failed) — leave the popover open with copy fallback.
    }
  };

  if (!session) return null;

  return (
    <div ref={wrapRef} style={s.shareWrap}>
      <button
        onClick={share}
        disabled={state.phase === "busy"}
        style={s.iconBtn}
        title={state.phase === "error" ? "Couldn't create share link" : "Share recipe"}
        aria-label="Share recipe"
      >
        {state.phase === "busy"
          ? <RefreshCw size={15} className="animate-spin" color="var(--c-text-muted)" />
          : <Share2 size={15} color={state.phase === "error" ? "var(--c-danger)" : "var(--c-text-muted)"} />}
      </button>

      {open && (
        <div style={s.sharePopover} role="dialog" aria-label="Share recipe">
          <button onClick={() => setState({ phase: "idle" })} style={s.sharePopoverClose} aria-label="Dismiss">
            <X size={14} />
          </button>
          {state.phase === "success" ? (
            <>
              <p style={s.sharePopoverLabel}>Share link</p>
              <input
                readOnly
                value={state.url}
                onFocus={(e) => e.currentTarget.select()}
                style={s.shareUrlInput}
              />
              {state.copied ? (
                <p style={s.shareCopiedLine}><CheckCircle2 size={13} /> Copied to clipboard</p>
              ) : (
                <p style={s.shareErrorLine}><AlertCircle size={13} /> Couldn't copy automatically — copy the link above</p>
              )}
              <div style={s.sharePopoverActions}>
                {canNativeShare && (
                  <button className="btn-primary btn--sm" onClick={() => nativeShare(state.url)}>Share…</button>
                )}
                <button className="btn-secondary btn--sm" onClick={() => copyAgain(state.url)}>
                  <Copy size={13} /> Copy link
                </button>
              </div>
            </>
          ) : (
            <p style={s.shareErrorLine}><AlertCircle size={13} /> Couldn't create share link — try again</p>
          )}
        </div>
      )}
    </div>
  );
}
