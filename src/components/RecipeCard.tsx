import { Clock, Users, Flame, ThumbsUp, ThumbsDown, Star, Printer } from "lucide-react";
import { s } from "../lib/styles";
import { useIsMobile } from "../lib/utils";
import { DIFFICULTY_LABELS, fmtRecipeQty, dietaryDisclaimer } from "../lib/format";

/* ============================ RecipeCard (TER-251) — standalone, no planner actions ============================ */
export default function RecipeCard({ meal, kcalInfo, onSaveRotation, onThumbUp, onThumbDown, isLiked }: { meal: any; kcalInfo?: { kcalPerServing: number | null; tier: string } | null; onSaveRotation?: () => void; onThumbUp?: () => void; onThumbDown?: () => void; isLiked?: boolean }) {
  const isMobile = useIsMobile();
  const totalMin = (meal.prepMinutes ?? 0) + (meal.cookMinutes ?? 0);
  const diffLabel = DIFFICULTY_LABELS[meal.difficulty] ?? "";

  const Ingredients = () => (
    <div>
      <p style={{ ...s.typeLabel, color: "var(--c-text-muted)", marginBottom: "var(--space-2)" }}>Ingredients</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-2)" }}>
        {(meal.ingredients ?? []).map((ing: any, i: number) => {
          const qty = fmtRecipeQty(ing);
          return (
            <li key={i} style={s.rcIngRow}>
              <span style={{ ...s.typeBody, color: "var(--c-text)" }}>
                {ing.name}{ing.staple && <span style={s.rcStaplePill}>staple</span>}
              </span>
              <span style={{ ...s.typeBodySm, color: "var(--c-text-muted)", textAlign: "right" as const, flexShrink: 0 }}>{qty}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );

  const Steps = () => (
    <div>
      <p style={{ ...s.typeLabel, color: "var(--c-text-muted)", marginBottom: "var(--space-2)" }}>Instructions</p>
      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "var(--space-3)" }}>
        {(meal.steps ?? []).map((step: string, i: number) => (
          <li key={i} style={s.rcStepRow}>
            <span style={s.rcStepMarker}>{i + 1}</span>
            <span style={{ ...s.typeBody, color: "var(--c-text)", paddingTop: 2 }}>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );

  return (
    <article style={{ ...s.rcCard, maxWidth: isMobile ? "none" : 680, margin: isMobile ? 0 : "0 auto" }}>
      {/* 1. Image slot — striped placeholder is the default state */}
      <div style={{ ...s.rcImgSlot, height: isMobile ? 190 : 240 }}>
        <span style={s.rcImgHint}>meal photo (optional)</span>
      </div>
      <div style={{ padding: "var(--space-5)" }}>
        {/* 2. Cuisine pill */}
        {meal.cuisine && <span style={s.rcCuisinePill}>{meal.cuisine}</span>}
        {/* 3. Meal name + description */}
        <h2 style={{ ...s.typeH2, color: "var(--c-text)", marginTop: meal.cuisine ? "var(--space-3)" : 0 }}>{meal.name}</h2>
        {meal.description && <p style={{ ...s.typeBodySm, color: "var(--c-text-muted)", marginTop: "var(--space-2)" }}>{meal.description}</p>}
        {/* 4. Meta row */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", marginTop: "var(--space-3)" }}>
          {totalMin > 0 && <span style={s.rcMetaItem}><Clock size={15} color="var(--c-primary)" />{totalMin} min</span>}
          {meal.servings && <span style={s.rcMetaItem}><Users size={15} color="var(--c-primary)" />Serves {meal.servings}</span>}
          {kcalInfo?.kcalPerServing != null && <span style={s.rcMetaItem}><Flame size={15} color="var(--c-primary)" />~{kcalInfo.kcalPerServing} Calories</span>}
        </div>
        {/* 5. Badges */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", marginTop: "var(--space-3)", alignItems: "center" }}>
          {kcalInfo?.kcalPerServing != null && (
            <span style={kcalInfo.tier === "estimate" ? s.rcKcalBadgeEst : s.rcKcalBadge}>
              {kcalInfo.tier === "usda" ? "USDA" : kcalInfo.tier === "catalog" ? "ALDI catalog" : "Estimated"} · {kcalInfo.kcalPerServing} Calories/serving
            </span>
          )}
          {meal.difficulty != null && (
            <span style={s.rcEffortBadge}>
              <span style={{ letterSpacing: 1 }}>{"●".repeat(meal.difficulty)}{"○".repeat(5 - meal.difficulty)}</span>{" "}{diffLabel}
            </span>
          )}
        </div>
        {meal.dietaryAvoid?.length > 0 && (
          <div style={{ ...s.reuseNote, marginTop: "var(--space-3)" }}>{dietaryDisclaimer(meal.dietaryAvoid)}</div>
        )}
        {/* 6. Divider */}
        <hr style={s.rcDivider} />
        {/* 7+8. Ingredients + Instructions */}
        {!isMobile ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: "var(--space-6)" }}>
            <Ingredients />
            <Steps />
          </div>
        ) : (
          <div style={{ display: "grid", gap: "var(--space-5)" }}>
            <Ingredients />
            <Steps />
          </div>
        )}
        {/* 9. Footer */}
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-5)", flexWrap: "wrap" }}>
          {onThumbUp && (
            <button
              onClick={onThumbUp}
              style={{ ...s.thumb, color: isLiked ? "var(--c-primary)" : "var(--c-text-muted)", borderColor: isLiked ? "var(--c-primary)" : "var(--c-border)" }}
              title="Like"
            ><ThumbsUp size={15} /></button>
          )}
          {onThumbDown && (
            <button
              onClick={onThumbDown}
              style={{ ...s.thumb, color: "var(--c-danger)", borderColor: "var(--c-danger-bg)" }}
              title="Dislike"
            ><ThumbsDown size={15} /></button>
          )}
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onSaveRotation}>
            <Star size={16} /> Save to Recipe Box
          </button>
          <button className="btn-ghost" aria-label="Print" onClick={() => window.print()} style={{ padding: "0 var(--space-4)" }}>
            <Printer size={16} />
          </button>
        </div>
      </div>
    </article>
  );
}
