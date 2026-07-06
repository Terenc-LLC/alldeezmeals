import { useState } from "react";
import { Plus, X, Check, AlertCircle } from "lucide-react";
import { s } from "../lib/styles";
import { CATEGORIES } from "../lib/recipeGenerate.js";
import { uid, useIsMobile } from "../lib/utils";

type IngRow = { id: string; name: string; rQty: string; rUnit: string; purchaseSize: string; purchaseQty: string; category: string };

export default function ManualRecipeForm({ rotation, onSave, onCancel }: { rotation: any[]; onSave: (data: any) => void; onCancel: () => void }) {
  const isMobile = useIsMobile();
  const [recipeName, setRecipeName] = useState("");
  const [description, setDescription] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [servings, setServings] = useState("4");
  const [prepMinutes, setPrepMinutes] = useState("0");
  const [cookMinutes, setCookMinutes] = useState("0");
  const [estKcal, setEstKcal] = useState("");
  const [difficulty, setDifficulty] = useState(2);
  const [steps, setSteps] = useState<{ id: string; text: string }[]>([{ id: uid(), text: "" }]);
  const [ings, setIngs] = useState<IngRow[]>([{ id: uid(), name: "", rQty: "", rUnit: "", purchaseSize: "", purchaseQty: "1", category: "Produce" }]);
  const [errors, setErrors] = useState<string[]>([]);

  const addStep = () => setSteps(p => [...p, { id: uid(), text: "" }]);
  const removeStep = (id: string) => setSteps(p => p.filter(s => s.id !== id));
  const updateStep = (id: string, text: string) => setSteps(p => p.map(s => s.id === id ? { ...s, text } : s));

  const addIng = () => setIngs(p => [...p, { id: uid(), name: "", rQty: "", rUnit: "", purchaseSize: "", purchaseQty: "1", category: "Produce" }]);
  const removeIng = (id: string) => setIngs(p => p.filter(i => i.id !== id));
  const patchIng = (id: string, patch: Partial<IngRow>) => setIngs(p => p.map(i => i.id === id ? { ...i, ...patch } : i));

  const validate = (): string[] => {
    const errs: string[] = [];
    const trimName = recipeName.trim();
    if (!trimName) errs.push("Recipe name is required.");
    const srv = Number(servings);
    if (!Number.isFinite(srv) || srv < 1) errs.push("Servings must be at least 1.");
    const validIngs = ings.filter(i => i.name.trim());
    if (validIngs.length === 0) errs.push("Add at least one ingredient.");
    for (const ing of validIngs) {
      if (!ing.purchaseSize.trim()) errs.push(`"${ing.name.trim()}" needs a purchase size (e.g. "2 lb bag").`);
    }
    if (trimName && rotation.some((r: any) => r.name.toLowerCase() === trimName.toLowerCase())) {
      errs.push(`"${trimName}" is already in your rotation — use a different name or remove the existing one first.`);
    }
    return errs;
  };

  const handleSave = () => {
    const errs = validate();
    if (errs.length) { setErrors(errs); return; }
    setErrors([]);
    const srv = Math.max(1, Math.round(Number(servings)));
    const validIngs = ings.filter(i => i.name.trim());
    const data: Record<string, any> = {
      name: recipeName.trim(),
      servings: srv,
      prepMinutes: Math.round(Number(prepMinutes) || 0),
      cookMinutes: Math.round(Number(cookMinutes) || 0),
      difficulty: Math.min(5, Math.max(0, difficulty)),
      steps: steps.map(s => s.text.trim()).filter(Boolean),
      ingredients: validIngs.map(i => ({
        name: i.name.trim(),
        recipeAmount: { qty: Number(i.rQty) || 0, unit: i.rUnit.trim() },
        purchaseSize: i.purchaseSize.trim(),
        purchaseQty: Math.max(1, Math.round(Number(i.purchaseQty) || 1)),
        category: CATEGORIES.includes(i.category) ? i.category : "Other",
      })),
    };
    if (description.trim()) data.description = description.trim();
    if (cuisine.trim()) data.cuisine = cuisine.trim();
    const kcal = Math.round(Number(estKcal));
    if (kcal > 0) data.estKcalPerServing = kcal;
    onSave(data);
  };

  const diffLabels = ["Premade", "Minimal", "Simple", "Moderate", "Involved", "Intricate"];

  return (
    <div style={{ ...s.card, display: "grid", gap: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={s.cardTitle}>New recipe</h3>
        <button onClick={onCancel} style={s.iconBtn}><X size={16} color="var(--c-text-muted)" /></button>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        <div>
          <label style={s.fieldLabel}>Recipe name *</label>
          <input value={recipeName} onChange={e => setRecipeName(e.target.value)} placeholder="e.g. One-Pan Chicken Thighs" style={{ ...s.input, width: "100%" }} />
        </div>
        <div>
          <label style={s.fieldLabel}>Description <span style={{ fontWeight: 400, textTransform: "none" as const }}>(optional)</span></label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="One short sentence" style={{ ...s.input, width: "100%" }} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: isMobile ? "wrap" as const : undefined }}>
          <div style={{ flex: 1, minWidth: 100 }}>
            <label style={s.fieldLabel}>Cuisine <span style={{ fontWeight: 400, textTransform: "none" as const }}>(optional)</span></label>
            <input value={cuisine} onChange={e => setCuisine(e.target.value)} placeholder="e.g. Italian" style={{ ...s.input, width: "100%" }} />
          </div>
          <div style={{ width: isMobile ? "100%" : 80 }}>
            <label style={s.fieldLabel}>Servings *</label>
            <input type="number" min={1} value={servings} onChange={e => setServings(e.target.value)} style={{ ...s.input, width: "100%", textAlign: "center" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: isMobile ? "wrap" as const : undefined }}>
          <div style={{ flex: 1, minWidth: isMobile ? "40%" : 80 }}>
            <label style={s.fieldLabel}>Prep (min)</label>
            <input type="number" min={0} value={prepMinutes} onChange={e => setPrepMinutes(e.target.value)} style={{ ...s.input, width: "100%", textAlign: "center" }} />
          </div>
          <div style={{ flex: 1, minWidth: isMobile ? "40%" : 80 }}>
            <label style={s.fieldLabel}>Cook (min)</label>
            <input type="number" min={0} value={cookMinutes} onChange={e => setCookMinutes(e.target.value)} style={{ ...s.input, width: "100%", textAlign: "center" }} />
          </div>
          <div style={{ flex: 1, minWidth: isMobile ? "40%" : 100 }}>
            <label style={s.fieldLabel}>Est. Calories/serving</label>
            <input type="number" min={0} value={estKcal} onChange={e => setEstKcal(e.target.value)} placeholder="optional" style={{ ...s.input, width: "100%", textAlign: "center" }} />
          </div>
        </div>
      </div>

      <div>
        <label style={s.fieldLabel}>Difficulty</label>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" as const, marginTop: 4 }}>
          {diffLabels.map((label, i) => (
            <button
              key={i}
              onClick={() => setDifficulty(i)}
              style={{
                padding: "5px 10px", borderRadius: 20, cursor: "pointer",
                border: difficulty === i ? "none" : "1px solid var(--c-border)",
                background: difficulty === i ? "var(--c-primary)" : "var(--c-surface-2)",
                color: difficulty === i ? "var(--c-on-primary)" : "var(--c-text-muted)",
                fontFamily: "var(--font-sans, inherit)", fontSize: 12, fontWeight: 600,
              }}
            >
              {i} · {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label style={s.fieldLabel}>Steps</label>
        <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
          {steps.map((step, idx) => (
            <div key={step.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ ...s.miniLabel, width: 18, flexShrink: 0, textAlign: "center" as const }}>{idx + 1}</span>
              <input
                value={step.text}
                onChange={e => updateStep(step.id, e.target.value)}
                placeholder={`Step ${idx + 1}`}
                style={{ ...s.input, flex: 1 }}
              />
              {steps.length > 1 && (
                <button onClick={() => removeStep(step.id)} style={s.iconBtn}><X size={13} color="var(--c-text-muted)" /></button>
              )}
            </div>
          ))}
        </div>
        <button onClick={addStep} style={{ ...s.addBtn, marginTop: 8 }}><Plus size={14} /> Add step</button>
      </div>

      <div>
        <label style={s.fieldLabel}>Ingredients *</label>
        <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
          {ings.map((ing) => (
            <div key={ing.id} style={{ ...s.dayBlock, display: "grid", gap: 6 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  value={ing.name}
                  onChange={e => patchIng(ing.id, { name: e.target.value })}
                  placeholder="Ingredient name"
                  style={{ ...s.input, flex: 1 }}
                />
                {ings.length > 1 && (
                  <button onClick={() => removeIng(ing.id)} style={s.iconBtn}><X size={13} color="var(--c-danger)" /></button>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <span style={{ ...s.miniLabel, whiteSpace: "nowrap" as const }}>Recipe</span>
                  <input type="number" min={0} step="any" value={ing.rQty} onChange={e => patchIng(ing.id, { rQty: e.target.value })} placeholder="qty" style={{ ...s.input, width: 52, textAlign: "center", fontSize: 12 }} />
                  <input value={ing.rUnit} onChange={e => patchIng(ing.id, { rUnit: e.target.value })} placeholder="unit" style={{ ...s.input, width: 64, fontSize: 12 }} />
                </div>
                <div style={{ display: "flex", gap: 4, alignItems: "center", flex: 1, minWidth: 140 }}>
                  <span style={{ ...s.miniLabel, whiteSpace: "nowrap" as const }}>Buy</span>
                  <input value={ing.purchaseSize} onChange={e => patchIng(ing.id, { purchaseSize: e.target.value })} placeholder='e.g. "2 lb bag" *' style={{ ...s.input, flex: 1, fontSize: 12 }} />
                  <input type="number" min={1} value={ing.purchaseQty} onChange={e => patchIng(ing.id, { purchaseQty: e.target.value })} style={{ ...s.input, width: 44, textAlign: "center", fontSize: 12 }} />
                </div>
                <select
                  value={ing.category}
                  onChange={e => patchIng(ing.id, { category: e.target.value })}
                  style={{ ...s.input, fontSize: 12, flex: 1, minWidth: 100 }}
                >
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
        <button onClick={addIng} style={{ ...s.addBtn, marginTop: 8 }}><Plus size={14} /> Add ingredient</button>
      </div>

      {errors.length > 0 && (
        <div style={{ background: "var(--c-danger-bg)", borderRadius: 8, padding: "10px 12px", display: "grid", gap: 4 }}>
          {errors.map((e, i) => (
            <p key={i} style={{ margin: 0, fontSize: 13, color: "var(--c-danger)", display: "flex", gap: 5, alignItems: "flex-start" }}>
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {e}
            </p>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
        <button onClick={handleSave} style={s.primaryBtn}><Check size={15} /> Save recipe</button>
        <button onClick={onCancel} style={s.ghostBtn}><X size={14} /> Cancel</button>
      </div>
    </div>
  );
}
