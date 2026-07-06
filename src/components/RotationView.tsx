import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { s } from "../lib/styles";
import ManualRecipeForm from "./ManualRecipeForm";
import RecipeCard from "./RecipeCard";
import ChipManager from "./ChipManager";

/* ============================ Rotation ============================ */
export default function RotationView({ rotation, setRotation, liked, setLiked, avoid, setAvoid, recipeStars, setRecipeStars }: any) {
  const [showForm, setShowForm] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const handleSaveManual = (data: any) => {
    setRotation((p: any[]) => [...p, data]);
    if (data.name) setLiked((p: string[]) => p.includes(data.name) ? p : [...p, data.name]);
    setShowForm(false);
  };

  if (selectedIdx !== null && rotation[selectedIdx]) {
    return (
      <div>
        <button className="btn-ghost btn--sm" style={{ marginBottom: "var(--space-4)" }} onClick={() => setSelectedIdx(null)}>
          ← Back to Recipe Box
        </button>
        <RecipeCard
          meal={rotation[selectedIdx]}
          onSaveRotation={() => setSelectedIdx(null)}
        />
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={s.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={s.cardTitle}>Recipe Box <span style={s.cardSub}>- saved favorites the planner leans toward</span></h3>
          <button onClick={() => setShowForm(v => !v)} style={s.addBtn}><Plus size={14} /> Add recipe</button>
        </div>
        {rotation.length === 0 && !showForm
          ? <p style={{ ...s.empty, marginTop: 8 }}>Tap "Recipe Box" on a meal you love to save it here.</p>
          : rotation.length > 0 && (
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {rotation.map((r: any, i: number) => {
                const rating = recipeStars[r.name] ?? 0;
                return (
                  <div key={i} style={s.rotItem}>
                    <button onClick={() => setSelectedIdx(i)} style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0, flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "var(--c-text)" }}>{r.name}</div>
                      <div style={s.cardSub}>{r.cuisine ? `${r.cuisine} · ` : ""}{r.ingredients?.length ?? 0} ingredients</div>
                    </button>
                    <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                      {[1, 2, 3, 4, 5].map(n => (
                        <button
                          key={n}
                          onClick={() => setRecipeStars((prev: Record<string, number>) => {
                            const next = { ...prev };
                            if (next[r.name] === n) delete next[r.name];
                            else next[r.name] = n;
                            return next;
                          })}
                          style={{ ...s.starBtn, color: n <= rating ? "var(--c-warning)" : "var(--c-border)" }}
                          title={n <= rating && n === rating ? "Clear rating" : `Rate ${n} star${n > 1 ? "s" : ""}`}
                        >★</button>
                      ))}
                    </div>
                    <button onClick={() => setRotation((p: any[]) => p.filter((_, idx) => idx !== i))} style={s.iconBtn}><Trash2 size={15} color="var(--c-danger)" /></button>
                  </div>
                );
              })}
            </div>
          )
        }
      </div>

      {showForm && (
        <ManualRecipeForm
          rotation={rotation}
          onSave={handleSaveManual}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div style={s.card}><h3 style={s.cardTitle}>Liked styles</h3><ChipManager items={liked} onRemove={(x: string) => setLiked((p: string[]) => p.filter((i) => i !== x))} empty="Thumbs-up meals show up here." tone="green" /></div>
      <div style={s.card}><h3 style={s.cardTitle}>Avoiding</h3><ChipManager items={avoid} onRemove={(x: string) => setAvoid((p: string[]) => p.filter((i) => i !== x))} empty="Thumbs-down meals get added here." tone="red" /></div>
    </div>
  );
}
