// TER-526: reads ?saveRecipe=<token> on mount, fetches the public snapshot, and
// appends it to the recipient's rotation. Mounted inside the authed/approved
// region of App — minimal-mount pattern (ShareListControls precedent).

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { s } from "../lib/styles";

type Status = "idle" | "importing" | "saved" | "duplicate" | "error";

export default function RecipeImportHandler({ rotation, setRotation }: { rotation: any[]; setRotation: (fn: (p: any[]) => any[]) => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [recipeName, setRecipeName] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("saveRecipe");
    if (!token) return;

    // Clear the param immediately so a refresh doesn't re-trigger the import.
    params.delete("saveRecipe");
    const nextSearch = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (nextSearch ? `?${nextSearch}` : ""));

    setStatus("importing");
    (async () => {
      try {
        const res = await fetch(`/api/shared-recipe/${encodeURIComponent(token)}`);
        if (!res.ok) {
          setStatus("error");
          return;
        }
        const json = await res.json();
        const recipe = json.snapshot;
        if (!recipe || typeof recipe.name !== "string") {
          setStatus("error");
          return;
        }
        setRecipeName(recipe.name);
        if (rotation.some((r: any) => r.name === recipe.name)) {
          setStatus("duplicate");
          return;
        }
        setRotation((p: any[]) => (p.some((r) => r.name === recipe.name) ? p : [...p, recipe]));
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    })();
    // Only run once on mount — the token is read from the initial URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "idle" || status === "importing") return null;

  const copy =
    status === "saved"
      ? { icon: <CheckCircle2 size={15} color="var(--c-primary)" />, text: `Saved "${recipeName}" to your recipe box.` }
      : status === "duplicate"
      ? { icon: <CheckCircle2 size={15} color="var(--c-text-muted)" />, text: `"${recipeName}" is already in your recipe box.` }
      : { icon: <XCircle size={15} color="var(--c-danger)" />, text: "Couldn't load that shared recipe." };

  return (
    <div style={{ ...s.lvSunken, display: "flex", alignItems: "center", gap: 8, margin: "0 0 var(--space-4)" }}>
      {copy.icon}
      <span style={{ ...s.typeBodySm, color: "var(--c-text)" }}>{copy.text}</span>
      <button onClick={() => setStatus("idle")} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--c-text-muted)" }} aria-label="Dismiss">
        <XCircle size={14} />
      </button>
    </div>
  );
}
