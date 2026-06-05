/* planning-v2.jsx — Planning > Meals — recipe card design pass v2
   Key changes from current MealCard:
   - Full ingredient list with quantities + purchase info (replaces pill row)
   - Full numbered steps, readable and spaced (replaces wall of text)
   - Reuse/pantry block: replaces dense amber paragraph with compact bullet lines
   - One card at a time with day-rail navigation (efficient review flow)
   - Actions row: Accept / Reject as primary CTAs, matching live app

   Token notes (no new tokens introduced):
   - Step number badges: bg var(--c-primary-tint), color var(--c-primary)
   - "reuse" note badge: bg var(--c-success-bg), color var(--c-success-text)
   - "staple" note badge: bg var(--c-warning-bg), color var(--c-warning)
   - "buy" purchase note: plain var(--c-text-muted), no bg
   - Reuse/pantry block: bg var(--c-warning-bg), border rgba(138,109,59,.18)
   - Ingredient row divider: var(--c-surface-2) hairline

   Exports: MealsPaneV2 */

function PlanIconV2({ name, size = 16, color = "currentColor", sw = 1.8, fill = "none" }) {
  const p = {
    check: <path d="M4 12.5l5 5 11-11" />,
    x:     <path d="M18 6L6 18M6 6l12 12" />,
    swap:  <><path d="M4 7h13l-3-3"/><path d="M20 17H7l3 3"/></>,
    star:  <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.8 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9 2.9-6Z"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    flame: <path d="M12 22c4 0 7-2.7 7-6.5 0-3-2-5.3-3.3-7.2-.3 1.8-1.4 2.7-2.2 2.7C12 8 13 4 9.5 2c.5 3-2 4.5-3.2 6.6C5.5 10 5 12 5 14c0 4.2 3.3 8 7 8Z"/>,
    users: <><path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1"/><circle cx="9" cy="7" r="3.2"/></>,
  }[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color}
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }}>{p}</svg>
  );
}

function PlanChevV2({ dir = "right", size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d={dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

/* =====================================================================
   PLAN DATA
   reuseNotes: short lines shown in the reuse/pantry block (one per item/group)
   pantryNote: comma-separated staples string
   ===================================================================== */
const PLAN_V2 = [
  {
    wd: "Thu", date: 4, wx: "⛅", temp: "86", ppl: 1,
    tag: "Mexican", meal: "Smoky Black Bean & Cheese Quesadillas",
    desc: "Crispy flour tortillas, smoky black beans, melted cheese — avocado crema for dipping.",
    prep: 8, cook: 10, serves: 1, kcal: 720, kcalEst: false, effort: 1, effortLabel: "Simple",
    reuseNotes: [
      "Avocado: buying a 2-ct bag — second avocado used Monday's salad",
      "Black beans & corn: opened cans, ~½ of each reused on Monday",
    ],
    pantryNote: "Cumin, chili powder, garlic powder, salt",
    ing: [
      { n: "Flour tortilla (burrito size)", q: "1 large",    p: "buy: 10-ct pkg",    t: "buy" },
      { n: "Black beans",                  q: "½ can",       p: "buy: 15 oz can",    t: "buy" },
      { n: "Canned corn",                  q: "2 spoonfuls", p: "buy: 15 oz can",    t: "buy" },
      { n: "Mexican blend cheese",          q: "handful",     p: "buy: 8 oz bag",     t: "buy" },
      { n: "Avocado",                      q: "1 ripe",      p: "reuse: 2-ct bag",   t: "reuse" },
      { n: "Lime",                         q: "1 wedge",     p: "reuse: lime bag",   t: "reuse" },
      { n: "Cumin, chili & garlic powder", q: "to taste",    p: "staple",            t: "staple" },
    ],
    steps: [
      "Drain and rinse the black beans. Mash half with a fork, stir in the rest. Season with cumin, chili powder, garlic powder, and salt.",
      "Stir a few spoonfuls of drained corn into the bean mixture.",
      "Mash the avocado with lime juice and a pinch of salt into a smooth crema. Set aside.",
      "Lay the tortilla flat. Spread bean mixture over half, top with a generous handful of cheese. Fold in half.",
      "Cook in an oiled skillet over medium heat, 3–4 min per side, until golden and the cheese has melted.",
      "Rest 1 min, cut into wedges, and serve with the avocado crema.",
    ],
  },
  {
    wd: "Fri", date: 5, wx: "🌧️", temp: "85", ppl: 3,
    tag: "Italian", meal: "Baked Penne with Meat Sauce",
    desc: "Seasoned ground beef and marinara baked under a blanket of melted mozzarella.",
    prep: 10, cook: 30, serves: 3, kcal: 780, kcalEst: true, effort: 2, effortLabel: "Moderate",
    pantryNote: "Olive oil, salt, pepper, garlic",
    ing: [
      { n: "Penne pasta",              q: "12 oz",      p: "buy: 16 oz box",  t: "buy" },
      { n: "Ground beef (85% lean)",   q: "1 lb",       p: "buy: 1 lb pkg",   t: "buy" },
      { n: "Marinara sauce",           q: "24 oz jar",  p: "buy: 24 oz jar",  t: "buy" },
      { n: "Mozzarella",               q: "8 oz",       p: "buy: 8 oz bag",   t: "buy" },
      { n: "Olive oil, salt, garlic",  q: "to taste",   p: "staple",          t: "staple" },
    ],
    steps: [
      "Preheat oven to 375°F. Boil salted water, cook penne to al dente. Drain.",
      "Brown the beef in a skillet over medium-high. Season with salt, pepper, and garlic. Drain excess fat.",
      "Stir in the marinara. Simmer 5 min. Combine with the penne.",
      "Transfer to a baking dish. Top generously with mozzarella.",
      "Bake 20 min until the cheese is melted and lightly golden. Rest 5 min before serving.",
    ],
  },
  {
    wd: "Sat", date: 6, wx: "⛈️", temp: "85", ppl: 3,
    tag: "BBQ", meal: "BBQ Pulled Chicken Sandwiches",
    desc: "Saucy pulled chicken on toasted buns with a quick cabbage slaw.",
    prep: 10, cook: 25, serves: 3, kcal: 680, kcalEst: true, effort: 1, effortLabel: "Simple",
    reuseNotes: [
      "Burger buns: 8-count pkg — 3 used here, 3 remaining used Tuesday",
      "Carrot: from the 2 lb bag; extras used in Wednesday's stew",
    ],
    pantryNote: "Apple cider vinegar, oil, sugar, salt, pepper",
    ing: [
      { n: "Chicken thighs",       q: "1.5 lb",     p: "buy: 1.5 lb pkg",      t: "buy" },
      { n: "BBQ sauce",            q: "⅓ cup",      p: "buy: 18 oz bottle",    t: "buy" },
      { n: "Burger buns",          q: "3",           p: "buy: 8-count pkg",     t: "buy" },
      { n: "Green cabbage",        q: "2 cups",      p: "buy: 1 head",          t: "buy" },
      { n: "Carrot",               q: "1, grated",  p: "reuse: from 2 lb bag", t: "reuse" },
      { n: "ACV, oil, sugar",      q: "to taste",   p: "staple",               t: "staple" },
      { n: "Salt, pepper",         q: "to taste",   p: "staple",               t: "staple" },
    ],
    steps: [
      "Season chicken thighs with salt and pepper on both sides.",
      "Sear in a hot oiled skillet, 4–5 min per side, until cooked through (165°F). Rest 5 min.",
      "Make the slaw: toss cabbage and grated carrot with ACV, oil, sugar, and a pinch of salt.",
      "Shred the chicken with two forks. Return to the pan, add BBQ sauce, stir over low heat 2 min.",
      "Toast the buns. Pile BBQ chicken onto buns and top with slaw. Serve immediately.",
    ],
  },
  {
    wd: "Sun", date: 7, wx: "☀️", temp: "88", ppl: 3,
    tag: "Asian", meal: "Teriyaki Chicken Rice Bowls",
    desc: "Glazed teriyaki chicken over fluffy jasmine rice with lightly steamed broccoli.",
    prep: 15, cook: 20, serves: 3, kcal: 650, kcalEst: true, effort: 2, effortLabel: "Moderate",
    reuseNotes: [
      "Chicken breast: cook a little extra — shredded leftovers used in Monday's salad",
    ],
    pantryNote: "Sesame oil, soy sauce, salt",
    ing: [
      { n: "Chicken breast",        q: "1.5 lb",       p: "buy: 1.5 lb pkg",    t: "buy" },
      { n: "Jasmine rice",          q: "1½ cups dry",  p: "buy: 2 lb bag",      t: "buy" },
      { n: "Broccoli florets",      q: "12 oz",        p: "buy: 12 oz bag",     t: "buy" },
      { n: "Teriyaki sauce",        q: "¼ cup",        p: "buy: 12 oz bottle",  t: "buy" },
      { n: "Sesame oil, soy sauce", q: "to taste",     p: "staple",             t: "staple" },
    ],
    steps: [
      "Cook rice per package directions. Steam broccoli until just tender.",
      "Slice chicken into thin strips. Season lightly with salt.",
      "Cook in hot sesame oil, 5–6 min, turning once, until golden.",
      "Add teriyaki and soy sauce. Stir and cook 2 min until glazed.",
      "Serve chicken and broccoli over rice. Drizzle remaining sauce.",
    ],
  },
  {
    wd: "Mon", date: 8, wx: "☀️", temp: "90", ppl: 3,
    tag: "Salad", meal: "Southwest Chicken Salad",
    desc: "Crisp romaine, black beans, corn, and avocado — with Sunday's chicken and a lime-cumin drizzle.",
    prep: 15, cook: 0, serves: 3, kcal: 520, kcalEst: true, effort: 1, effortLabel: "Simple",
    reuseNotes: [
      "Cooked chicken breast: made Sunday, in the fridge — shred straight from cold",
      "Black beans: ~½ can remaining from Thursday's quesadillas",
      "Canned corn: ~½ can remaining from Thursday",
      "Avocado: second avocado from Thursday's 2-ct bag",
      "Lime: from the bag purchased Thursday",
    ],
    pantryNote: "Olive oil, salt, cumin",
    ing: [
      { n: "Romaine hearts",          q: "½ head",      p: "buy: 3-count pkg",   t: "buy" },
      { n: "Cooked chicken breast",   q: "1½ cups",     p: "reuse: from Sun",    t: "reuse" },
      { n: "Black beans",             q: "½ can",       p: "reuse: from Thu",    t: "reuse" },
      { n: "Canned corn",             q: "3 tbsp",      p: "reuse: from Thu",    t: "reuse" },
      { n: "Avocado",                 q: "1 ripe",      p: "reuse: 2-ct bag",    t: "reuse" },
      { n: "Lime",                    q: "½",           p: "reuse: lime bag",    t: "reuse" },
      { n: "Cilantro",                q: "handful",     p: "buy: bunch",         t: "buy" },
      { n: "Olive oil, salt, cumin",  q: "to taste",    p: "staple",             t: "staple" },
    ],
    steps: [
      "Shred the pre-cooked chicken from the fridge with two forks.",
      "Chop romaine. Drain and rinse the beans and corn. Cut avocado into chunks.",
      "Dressing: squeeze ½ lime, add 1 tbsp olive oil, cumin, and salt. Whisk.",
      "Arrange romaine in a bowl. Add chicken, beans, corn, and avocado.",
      "Drizzle dressing, scatter cilantro, toss gently. Taste and serve.",
    ],
  },
  {
    wd: "Tue", date: 9, wx: "⛅", temp: "84", ppl: 3,
    tag: "American", meal: "Classic Burgers with Oven Fries",
    desc: "Juicy homemade burgers and crispy oven-baked fries — a weeknight crowd-pleaser.",
    prep: 15, cook: 30, serves: 3, kcal: 820, kcalEst: false, effort: 2, effortLabel: "Moderate",
    reuseNotes: [
      "Burger buns: 3 remaining from Saturday's 8-count pkg",
      "Russet potatoes: from the 5 lb bag — extra potatoes used in Wednesday's stew",
    ],
    pantryNote: "Ketchup, mustard, olive oil, salt, pepper",
    ing: [
      { n: "Ground beef (85%)",  q: "1 lb",       p: "buy: 1 lb pkg",        t: "buy" },
      { n: "Burger buns",        q: "3",           p: "reuse: from Sat pkg",  t: "reuse" },
      { n: "Russet potatoes",    q: "2 large",     p: "buy: 5 lb bag",        t: "buy" },
      { n: "Cheddar slices",     q: "3",           p: "buy: 8 oz pkg",        t: "buy" },
      { n: "Tomato, lettuce",    q: "as needed",   p: "buy: loose",           t: "buy" },
      { n: "Ketchup, mustard",   q: "to taste",    p: "staple",               t: "staple" },
      { n: "Olive oil, salt",    q: "to taste",    p: "staple",               t: "staple" },
    ],
    steps: [
      "Preheat oven to 425°F. Cut potatoes into wedges, toss with oil and salt. Spread on a sheet pan.",
      "Roast fries 25–30 min, flipping halfway, until golden and crisp.",
      "Form beef into 3 patties. Season both sides with salt and pepper.",
      "Cook in a hot skillet, 4–5 min per side. Add cheese the last minute.",
      "Toast buns in the same pan. Build burgers and serve with the oven fries.",
    ],
  },
  {
    wd: "Wed", date: 10, wx: "🌧️", temp: "72", ppl: 3,
    tag: "Comfort", meal: "Beef & Vegetable Stew",
    desc: "A cozy, slow-simmered stew with crusty bread — perfect for a cool, rainy night.",
    prep: 20, cook: 60, serves: 3, kcal: 690, kcalEst: true, effort: 3, effortLabel: "Some effort",
    reuseNotes: [
      "Russet potatoes: from Tuesday's 5 lb bag",
      "Carrots: from the 2 lb bag, started earlier this week",
    ],
    pantryNote: "Tomato paste, olive oil, thyme, salt, pepper",
    ing: [
      { n: "Beef stew meat",           q: "1 lb",       p: "buy: 1 lb pkg",         t: "buy" },
      { n: "Russet potatoes",          q: "2 medium",   p: "reuse: from Tue bag",   t: "reuse" },
      { n: "Carrots",                  q: "2, chopped", p: "buy: 2 lb bag",         t: "buy" },
      { n: "Celery",                   q: "2 stalks",   p: "buy: 1 head",           t: "buy" },
      { n: "Beef broth",               q: "3 cups",     p: "buy: 32 oz carton",     t: "buy" },
      { n: "Crusty bread",             q: "1 loaf",     p: "buy: bakery loaf",      t: "buy" },
      { n: "Tomato paste, oil, thyme", q: "to taste",   p: "staple",                t: "staple" },
    ],
    steps: [
      "Cut beef into 1-inch cubes. Season well with salt and pepper.",
      "Brown in batches in a hot heavy pot. Remove and set aside.",
      "Add vegetables to the pot. Cook 3–4 min, stirring.",
      "Stir in tomato paste, add broth and beef. Bring to a boil.",
      "Reduce to a low simmer. Cover and cook 45–60 min until beef is fork-tender.",
      "Adjust seasoning. Serve in deep bowls with thick slices of crusty bread.",
    ],
  },
];

/* =====================================================================
   REUSE BLOCK — replaces dense amber paragraph
   Compact bullet lines, one per ingredient or group.
   Token: bg var(--c-warning-bg), border rgba(138,109,59,.18)
   ===================================================================== */
function ReuseBlock({ reuseNotes, pantryNote }) {
  if (!reuseNotes && !pantryNote) return null;
  const hasReuse = reuseNotes && reuseNotes.length > 0;
  return (
    <div style={{
      background: "var(--c-warning-bg)",
      border: "1px solid rgba(138,109,59,0.18)",
      borderRadius: "var(--radius-sm)",
      padding: "var(--space-3) var(--space-4)",
      marginBottom: "var(--space-4)",
      display: "grid", gap: "var(--space-2)",
    }}>
      {hasReuse && (
        <div>
          <p style={{
            fontSize: "var(--t-label-size)", fontWeight: 700,
            letterSpacing: "var(--t-label-tracking)", textTransform: "uppercase",
            color: "var(--c-warning)", marginBottom: "var(--space-2)",
          }}>Reuses this week</p>
          <div style={{ display: "grid", gap: "var(--space-1)" }}>
            {reuseNotes.map((note, i) => (
              <div key={i} style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-start" }}>
                {/* ↺ glyph — same amber colour, quiet */}
                <span style={{
                  fontSize: 13, lineHeight: "18px", color: "var(--c-warning)",
                  flexShrink: 0, marginTop: 1,
                }}>↺</span>
                <span className="wm-bodysm" style={{ lineHeight: "18px", color: "var(--c-text)" }}>{note}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {pantryNote && (
        <p className="wm-bodysm" style={{
          color: "var(--c-text-muted)",
          paddingTop: hasReuse ? "var(--space-1)" : 0,
          borderTop: hasReuse ? "1px solid rgba(138,109,59,0.14)" : "none",
          marginTop: hasReuse ? "var(--space-1)" : 0,
        }}>
          <strong style={{ fontWeight: 700, color: "var(--c-warning)" }}>Pantry: </strong>{pantryNote}
        </p>
      )}
    </div>
  );
}

/* =====================================================================
   MEAL CARD V2 — full recipe review
   ===================================================================== */
function MealCardV2({ d, cardIdx, total, onPrev, onNext }) {
  const [accepted, setAccepted] = React.useState(false);
  const [vote,     setVote]     = React.useState(null); // "up" | "down" | null
  const [saved,    setSaved]    = React.useState(false);

  const noteStyle = {
    buy:    { badge: false, color: "var(--c-text-muted)" },
    reuse:  { badge: true,  color: "var(--c-success-text)", bg: "var(--c-success-bg)" },
    staple: { badge: true,  color: "var(--c-warning)",      bg: "var(--c-warning-bg)" },
  };

  return (
    <div className="wm-card" style={{ padding: 0, overflow: "hidden" }}>

      {/* ---- Card header: context + accept state + nav ---- */}
      <div style={{
        padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--c-border)",
        display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap",
      }}>
        <span className="wm-caption wm-muted" style={{ flex: 1, textTransform: "uppercase", letterSpacing: ".04em" }}>
          {d.wd}, Jun {d.date}&nbsp;·&nbsp;{d.ppl} ppl&nbsp;·&nbsp;<span style={{ fontSize: 12 }}>{d.wx}</span>&nbsp;{d.temp}°F
        </span>
        {/* Accept state badge — shown only once accepted */}
        {accepted && (
          <span className="wm-tag" style={{
            background: "var(--c-success-bg)", color: "var(--c-success-text)",
            fontWeight: 700, gap: 5, padding: "4px 9px",
          }}>
            <PlanIconV2 name="check" size={11} color="var(--c-success-text)" sw={2.6} /> Accepted
          </span>
        )}
        {/* Compact prev / position / next */}
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <button onClick={onPrev} disabled={cardIdx === 0}
            className="wm-btn wm-btn--ghost wm-btn--sm"
            style={{ padding: "0 6px", minHeight: 30, opacity: cardIdx === 0 ? 0.3 : 1 }}
            aria-label="Previous meal">
            <PlanChevV2 dir="left" size={14} />
          </button>
          <span className="wm-caption wm-muted" style={{ minWidth: 32, textAlign: "center" }}>{cardIdx + 1}/{total}</span>
          <button onClick={onNext} disabled={cardIdx === total - 1}
            className="wm-btn wm-btn--ghost wm-btn--sm"
            style={{ padding: "0 6px", minHeight: 30, opacity: cardIdx === total - 1 ? 0.3 : 1 }}
            aria-label="Next meal">
            <PlanChevV2 dir="right" size={14} />
          </button>
        </div>
      </div>

      <div style={{ padding: "var(--space-4)" }}>

        {/* ---- Recipe identity ---- */}
        <span className="wm-tag wm-tag--cuisine">{d.tag}</span>
        <h2 style={{ fontSize: 21, lineHeight: "27px", fontWeight: 700, letterSpacing: "-0.01em",
          margin: "var(--space-3) 0 var(--space-2)" }}>{d.meal}</h2>
        <p className="wm-bodysm wm-muted" style={{ marginBottom: "var(--space-4)", lineHeight: "20px" }}>{d.desc}</p>

        {/* ---- Meta row ---- */}
        <div style={{
          display: "flex", flexWrap: "wrap", gap: "var(--space-3)", alignItems: "center",
          paddingBottom: "var(--space-4)", borderBottom: "1px solid var(--c-border)",
        }}>
          <span className="wm-bodysm" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--c-text)" }}>
            <PlanIconV2 name="clock" size={14} color="var(--c-primary)" />
            Prep {d.prep} · Cook {d.cook} min
          </span>
          <span className="wm-bodysm" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--c-text)" }}>
            <PlanIconV2 name="flame" size={14} color="var(--c-primary)" />
            ~{d.kcal} kcal
            {d.kcalEst && (
              <span className="wm-tag wm-tag--est" style={{ padding: "1px 5px", fontSize: 10, marginLeft: 2 }}>Est.</span>
            )}
          </span>
          <span className="wm-bodysm" style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--c-text)" }}>
            <PlanIconV2 name="users" size={14} color="var(--c-primary)" />
            Serves {d.serves}
          </span>
          <span className="wm-tag wm-tag--effort" style={{ marginLeft: "auto" }}>
            <span style={{ letterSpacing: 1 }}>{"●".repeat(d.effort) + "○".repeat(5 - d.effort)}</span>&nbsp;{d.effortLabel}
          </span>
        </div>

        {/* ---- Reuse / pantry block ---- */}
        <div style={{ paddingTop: "var(--space-4)" }}>
          <ReuseBlock reuseNotes={d.reuseNotes} pantryNote={d.pantryNote} />
        </div>

        {/* ---- Ingredients ---- */}
        <div>
          <p className="wm-label wm-muted" style={{ marginBottom: "var(--space-3)" }}>
            Ingredients · {d.ing.length}
          </p>
          <div>
            {d.ing.map((ing, i) => {
              const ns      = noteStyle[ing.t];
              const notLast = i < d.ing.length - 1;
              return (
                <div key={ing.n} style={{
                  display: "flex", alignItems: "baseline", gap: "var(--space-2)",
                  padding: "9px 0",
                  borderBottom: notLast ? "1px solid var(--c-surface-2)" : "none",
                }}>
                  <span className="wm-body" style={{ flex: 1, fontWeight: 600 }}>{ing.n}</span>
                  <span className="wm-caption wm-muted" style={{ flexShrink: 0, textAlign: "right", minWidth: 58 }}>{ing.q}</span>
                  {ns.badge ? (
                    <span style={{
                      flexShrink: 0, fontSize: 10, fontWeight: 600, lineHeight: 1,
                      color: ns.color, background: ns.bg,
                      padding: "2px 6px", borderRadius: "var(--radius-pill)", whiteSpace: "nowrap",
                    }}>{ing.p}</span>
                  ) : (
                    <span className="wm-caption" style={{ flexShrink: 0, color: "var(--c-text-muted)", whiteSpace: "nowrap" }}>{ing.p}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <hr className="wm-divider" />

        {/* ---- Steps ---- */}
        <div>
          <p className="wm-label wm-muted" style={{ marginBottom: "var(--space-4)" }}>How to make it</p>
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-4)" }}>
            {d.steps.map((st, i) => (
              <li key={i} style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
                <span style={{
                  flexShrink: 0, width: 26, height: 26, marginTop: 1,
                  borderRadius: "var(--radius-pill)",
                  background: "var(--c-primary-tint)", color: "var(--c-primary)",
                  display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12,
                }}>{i + 1}</span>
                <span className="wm-body" style={{ lineHeight: "22px", paddingTop: 3 }}>{st}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* ---- Actions — Accept / Reject primary, thumbs / save / next secondary ---- */}
        <div style={{
          marginTop: "var(--space-5)", paddingTop: "var(--space-4)",
          borderTop: "1px solid var(--c-border)",
          display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap",
        }}>
          {/* Accept */}
          <button onClick={() => setAccepted(a => !a)}
            className={`wm-btn wm-btn--sm ${accepted ? "wm-btn--secondary" : "wm-btn--primary"}`}
            style={accepted ? { color: "var(--c-success-text)", borderColor: "var(--c-success-bg)", background: "var(--c-success-bg)" } : {}}>
            <PlanIconV2 name="check" size={14} color={accepted ? "var(--c-success-text)" : "var(--c-on-primary)"} sw={2.6} />
            {accepted ? "Accepted" : "Accept"}
          </button>
          {/* Reject */}
          <button className="wm-btn wm-btn--ghost wm-btn--sm"
            style={{ color: "var(--c-danger)", borderColor: "var(--c-danger-bg)" }}>
            <PlanIconV2 name="x" size={14} color="var(--c-danger)" sw={2.2} /> Reject
          </button>

          <span style={{ flex: 1 }} />

          {/* Thumbs */}
          <button onClick={() => setVote(vote === "up" ? null : "up")}
            className="wm-btn wm-btn--ghost wm-btn--sm"
            style={{ padding: "0 10px",
              borderColor: vote === "up" ? "var(--c-primary)" : undefined,
              color: vote === "up" ? "var(--c-primary)" : undefined }}
            aria-label="Thumbs up">👍</button>
          <button onClick={() => setVote(vote === "down" ? null : "down")}
            className="wm-btn wm-btn--ghost wm-btn--sm"
            style={{ padding: "0 10px", borderColor: vote === "down" ? "var(--c-danger)" : undefined }}
            aria-label="Thumbs down">👎</button>

          {/* Recipe Box */}
          <button onClick={() => setSaved(s => !s)}
            className="wm-btn wm-btn--ghost wm-btn--sm"
            style={{ padding: "0 10px",
              borderColor: saved ? "var(--c-primary)" : undefined,
              color: saved ? "var(--c-primary)" : undefined }}
            aria-label="Save to Recipe Box">
            <PlanIconV2 name="star" size={15} fill={saved ? "currentColor" : "none"} />
          </button>

          {/* Next */}
          <button onClick={onNext} disabled={cardIdx === total - 1}
            className="wm-btn wm-btn--ghost wm-btn--sm"
            style={{ opacity: cardIdx === total - 1 ? 0.4 : 1 }}>
            {cardIdx === total - 1 ? "All reviewed ✓" : `Next: ${PLAN_V2[cardIdx + 1].wd} →`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
   MEALS PANE V2 — one card at a time, day-rail navigation
   ===================================================================== */
function MealsPaneV2() {
  const [idx, setIdx] = React.useState(0);
  const total = PLAN_V2.length;

  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="wm-bodysm wm-muted">{total} of {total} dinners reviewed</span>
        <span className="wm-bodysm" style={{ color: "var(--c-primary)", fontWeight: 700, cursor: "pointer" }}>Regenerate all ↻</span>
      </div>

      {/* Day rail */}
      <div style={{ display: "flex", gap: "var(--space-1)" }}>
        {PLAN_V2.map((d, i) => (
          <button key={d.date} onClick={() => setIdx(i)}
            style={{
              flex: "1 1 0", padding: "6px 2px", borderRadius: "var(--radius-sm)", border: "none",
              background: i === idx ? "var(--c-primary)" : "var(--c-surface-2)",
              color: i === idx ? "var(--c-on-primary)" : "var(--c-text-muted)",
              fontSize: 11, fontWeight: 700, fontFamily: "var(--font-sans)",
              cursor: "pointer", transition: "background .15s", textAlign: "center",
            }}>{d.wd}</button>
        ))}
      </div>

      <MealCardV2
        key={idx}
        d={PLAN_V2[idx]}
        cardIdx={idx}
        total={total}
        onPrev={() => setIdx(i => Math.max(0, i - 1))}
        onNext={() => setIdx(i => Math.min(total - 1, i + 1))}
      />
    </div>
  );
}

Object.assign(window, { MealsPaneV2 });
