// TER-526: Public, unauthenticated recipe page rendered at /r/[token].
// Talks ONLY to the public shared-recipe endpoint via fetch — no Supabase client,
// no auth, no user-state imports. Renders zero account/PII.

import { useState, useEffect } from "react";
import { DIFFICULTY_LABELS, fmtRecipeQty, dietaryDisclaimer } from "./lib/format";

type Snapshot = {
  name: string;
  servings?: number;
  prepMinutes?: number;
  cookMinutes?: number;
  difficulty?: number;
  cuisine?: string;
  description?: string;
  estKcalPerServing?: number;
  dietaryAvoid?: string[];
  steps: string[];
  ingredients: Array<{ name: string; recipeAmount?: { qty: number; unit: string } }>;
};

type Load =
  | { status: "loading" }
  | { status: "ready"; snapshot: Snapshot }
  | { status: "gone" }
  | { status: "error" };

const s = {
  page: {
    minHeight: "100dvh",
    background: "var(--c-bg)",
    color: "var(--c-text)",
    fontFamily: "inherit",
  } as const,
  container: {
    maxWidth: "680px",
    margin: "0 auto",
    padding: "var(--space-4) var(--space-4) var(--space-8)",
  } as const,
  title: {
    fontSize: "var(--t-h1-size)",
    lineHeight: "var(--t-h1-lh)",
    fontWeight: 600,
    margin: "var(--space-2) 0 0",
  } as const,
  cuisinePill: {
    display: "inline-block",
    fontSize: "var(--t-label-size)",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "var(--t-label-tracking)",
    color: "var(--c-primary)",
  } as const,
  description: {
    fontSize: "var(--t-bodysm-size)",
    lineHeight: "var(--t-bodysm-lh)",
    color: "var(--c-text-muted)",
    marginTop: "var(--space-2)",
  } as const,
  metaRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "var(--space-4)",
    marginTop: "var(--space-3)",
    fontSize: "var(--t-bodysm-size)",
    color: "var(--c-text-muted)",
  } as const,
  disclaimer: {
    marginTop: "var(--space-3)",
    padding: "var(--space-3)",
    background: "var(--c-surface-2)",
    borderRadius: "var(--radius-md)",
    fontSize: "var(--t-bodysm-size)",
    color: "var(--c-text-muted)",
  } as const,
  divider: {
    border: "none",
    borderTop: "1px solid var(--c-border)",
    margin: "var(--space-5) 0",
  } as const,
  sectionTitle: {
    fontSize: "var(--t-label-size)",
    lineHeight: "var(--t-label-lh)",
    fontWeight: 600,
    letterSpacing: "var(--t-label-tracking)",
    textTransform: "uppercase" as const,
    color: "var(--c-text-muted)",
    margin: "0 0 var(--space-3)",
  } as const,
  ingList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "grid",
    gap: "var(--space-2)",
  } as const,
  ingRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "var(--space-3)",
    fontSize: "var(--t-body-size)",
  } as const,
  stepList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "grid",
    gap: "var(--space-3)",
  } as const,
  stepRow: {
    display: "flex",
    gap: "var(--space-3)",
    fontSize: "var(--t-body-size)",
    lineHeight: "var(--t-body-lh)",
  } as const,
  stepMarker: {
    flex: "0 0 auto",
    width: "24px",
    height: "24px",
    borderRadius: "50%",
    background: "var(--c-primary)",
    color: "var(--c-on-primary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "13px",
    fontWeight: 700,
  } as const,
  ctaBanner: {
    marginTop: "var(--space-6)",
    padding: "var(--space-5)",
    background: "var(--c-surface)",
    border: "1px solid var(--c-border)",
    borderRadius: "var(--radius-md)",
    textAlign: "center" as const,
    display: "grid",
    gap: "var(--space-3)",
  } as const,
  ctaBtn: {
    display: "inline-block",
    padding: "var(--space-3) var(--space-5)",
    background: "var(--c-primary)",
    color: "var(--c-on-primary)",
    borderRadius: "var(--radius-md)",
    fontWeight: 600,
    textDecoration: "none",
    border: "none",
    cursor: "pointer",
    fontSize: "var(--t-body-size)",
  } as const,
  ctaSecondary: {
    fontSize: "var(--t-bodysm-size)",
    color: "var(--c-text-muted)",
    margin: 0,
  } as const,
  center: {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center" as const,
    padding: "var(--space-6)",
    gap: "var(--space-2)",
  } as const,
  centerTitle: {
    fontSize: "var(--t-h2-size)",
    lineHeight: "var(--t-h2-lh)",
    fontWeight: 600,
    margin: 0,
  } as const,
  centerText: {
    fontSize: "var(--t-body-size)",
    lineHeight: "var(--t-body-lh)",
    color: "var(--c-text-muted)",
    margin: 0,
    maxWidth: "34ch",
  } as const,
};

export default function SharedRecipePage({ token }: { token: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/shared-recipe/${encodeURIComponent(token)}`);
        if (res.status === 404 || res.status === 410) {
          if (!cancelled) setLoad({ status: "gone" });
          return;
        }
        if (!res.ok) {
          if (!cancelled) setLoad({ status: "error" });
          return;
        }
        const json = await res.json();
        if (!cancelled) setLoad({ status: "ready", snapshot: json.snapshot });
      } catch {
        if (!cancelled) setLoad({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (load.status === "loading") {
    return (
      <div style={s.center}>
        <p style={s.centerText}>Loading the recipe…</p>
      </div>
    );
  }

  if (load.status === "gone") {
    return (
      <div style={s.center}>
        <div style={{ fontSize: "40px" }}>🍽️</div>
        <h1 style={s.centerTitle}>This recipe is no longer available</h1>
        <p style={s.centerText}>Ask whoever sent it to share a fresh link.</p>
      </div>
    );
  }

  if (load.status === "error") {
    return (
      <div style={s.center}>
        <div style={{ fontSize: "40px" }}>🍽️</div>
        <h1 style={s.centerTitle}>Can’t load this recipe right now</h1>
        <p style={s.centerText}>Something went wrong reaching the recipe. Check your connection and try again.</p>
      </div>
    );
  }

  const { snapshot } = load;
  const totalMin = (snapshot.prepMinutes ?? 0) + (snapshot.cookMinutes ?? 0);
  const diffLabel = snapshot.difficulty != null ? DIFFICULTY_LABELS[snapshot.difficulty] : "";

  return (
    <div style={s.page}>
      <div style={s.container}>
        {snapshot.cuisine && <span style={s.cuisinePill}>{snapshot.cuisine}</span>}
        <h1 style={s.title}>{snapshot.name}</h1>
        {snapshot.description && <p style={s.description}>{snapshot.description}</p>}

        <div style={s.metaRow}>
          {totalMin > 0 && <span>{totalMin} min</span>}
          {snapshot.servings != null && <span>Serves {snapshot.servings}</span>}
          {diffLabel && <span>{diffLabel}</span>}
          {snapshot.estKcalPerServing != null && <span>~{snapshot.estKcalPerServing} Calories/serving</span>}
        </div>

        {snapshot.dietaryAvoid && snapshot.dietaryAvoid.length > 0 && (
          <div style={s.disclaimer}>{dietaryDisclaimer(snapshot.dietaryAvoid)}</div>
        )}

        <hr style={s.divider} />

        <section>
          <h2 style={s.sectionTitle}>Ingredients</h2>
          <ul style={s.ingList}>
            {snapshot.ingredients.map((ing, i) => (
              <li key={i} style={s.ingRow}>
                <span>{ing.name}</span>
                <span style={{ color: "var(--c-text-muted)" }}>{fmtRecipeQty(ing)}</span>
              </li>
            ))}
          </ul>
        </section>

        <hr style={s.divider} />

        <section>
          <h2 style={s.sectionTitle}>Instructions</h2>
          <ol style={s.stepList}>
            {snapshot.steps.map((step, i) => (
              <li key={i} style={s.stepRow}>
                <span style={s.stepMarker}>{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <div style={s.ctaBanner}>
          <a href={`/?saveRecipe=${encodeURIComponent(token)}`} style={s.ctaBtn}>
            Save to my recipe box
          </a>
          <p style={s.ctaSecondary}>
            ALLDEEZMeals plans your week of ALDI dinners. <a href="/" style={{ color: "var(--c-primary)" }}>Request access</a>
          </p>
        </div>
      </div>
    </div>
  );
}
