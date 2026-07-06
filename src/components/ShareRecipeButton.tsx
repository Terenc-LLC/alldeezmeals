import { useState } from "react";
import { Share2, CheckCircle2 } from "lucide-react";
import { s } from "../lib/styles";

export default function ShareRecipeButton({ session, recipe }: { session: any; recipe: any }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  const token = session?.access_token ?? "";

  const share = async () => {
    if (!token || busy) return;
    setBusy(true);
    setError(false);
    try {
      const r = await fetch("/api/shared-recipe/create", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ recipe }),
      });
      if (!r.ok) { setError(true); return; }
      const data = await r.json();
      await navigator.clipboard.writeText(`${window.location.origin}${data.url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  if (!session) return null;

  return (
    <button onClick={share} disabled={busy} style={s.iconBtn} title={error ? "Couldn't create share link" : "Share recipe"} aria-label="Share recipe">
      {copied ? <CheckCircle2 size={15} color="var(--c-primary)" /> : <Share2 size={15} color={error ? "var(--c-danger)" : "var(--c-text-muted)"} />}
    </button>
  );
}
