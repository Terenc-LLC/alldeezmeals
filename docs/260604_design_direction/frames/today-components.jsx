/* today-components.jsx — ALLDEEZMeals "Today" tab (cook mode)
   Replaces the old "This Week" tab: one day at a time, ready to cook on a
   phone or tablet propped on the counter. Reuses the global Icon helper and
   the same recipe vocabulary as RecipeCard (mockup-components.jsx) so the
   recipe presentation stays consistent across the app.
   Exports TodayCook to window. */

/* NB: no top-level `const { useState } = React` — that collides with the
   same declaration in other babel <script> tags (shared global scope).
   Use React.useState directly inside the component instead. */

/* Self-contained icon set (no dependency on mockup-components.jsx's Icon). */
function TodayIcon({ name, size = 16, color = "currentColor", strokeWidth = 1.8, fill = "none", style }) {
  const p = {
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    users: <><path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" /><circle cx="9" cy="7" r="3.2" /><path d="M22 19v-1a4 4 0 0 0-3-3.8" /><path d="M16 3.2A4 4 0 0 1 16 11" /></>,
    flame: <path d="M12 22c4 0 7-2.7 7-6.5 0-3-2-5.3-3.3-7.2-.3 1.8-1.4 2.7-2.2 2.7C12 8 13 4 9.5 2c.5 3-2 4.5-3.2 6.6C5.5 10 5 12 5 14c0 4.2 3.3 8 7 8Z" />,
    check: <path d="M4 12.5l5 5 11-11" />,
    star: <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.8 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9 2.9-6Z" />,
  }[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}>{p}</svg>
  );
}

/* tap-to-rate star row */
function TodayStars({ value = 0, onChange }) {
  const [hover, setHover] = React.useState(0);
  return (
    <div style={{ display: "flex", gap: 4 }} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = (hover || value) >= n;
        return (
          <button key={n} onClick={() => onChange(n)} onMouseEnter={() => setHover(n)}
            aria-label={n + (n > 1 ? " stars" : " star")}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 2, lineHeight: 0 }}>
            <TodayIcon name="star" size={28} color={on ? "var(--c-accent)" : "var(--c-border)"} fill={on ? "var(--c-accent)" : "none"} strokeWidth={1.6} />
          </button>
        );
      })}
    </div>
  );
}

/* ---- the week the user planned (mirrors the Setup screen) ---- */
const WEEK = [
  { wd: "Thu", date: 4, cuisine: "Mexican",      wx: "⛅", temp: "86°" },
  { wd: "Fri", date: 5, cuisine: "Italian",      wx: "🌧️", temp: "85°" },
  { wd: "Sat", date: 6, cuisine: "BBQ",          wx: "⛈️", temp: "85°" },
  { wd: "Sun", date: 7, cuisine: "Asian",        wx: "☀️", temp: "88°" },
  { wd: "Mon", date: 8, cuisine: "Salad",        wx: "☀️", temp: "90°" },
  { wd: "Tue", date: 9, cuisine: "American",     wx: "⛅", temp: "84°" },
  { wd: "Wed", date: 10, cuisine: "Comfort food", wx: "🌧️", temp: "72°" },
];

/* ---- today's meal — Thu, Jun 4 (matches the real planner data) ---- */
const TODAY_MEAL = {
  name: "Smoky Black Bean & Cheese Quesadillas",
  cuisine: "Mexican",
  description: "Crispy flour tortillas stuffed with smoky black beans, melted cheese, and corn — with a quick avocado crema for dipping.",
  prep: 8, cook: 10, servings: 1, kcal: 720,
  difficulty: 2, difficultyLabel: "Simple",
  ingredients: [
    { name: "Flour tortilla (burrito size)", qty: "1 large" },
    { name: "Black beans", qty: "½ can, drained" },
    { name: "Canned corn", qty: "2–3 spoonfuls" },
    { name: "Mexican blend cheese", qty: "handful, shredded" },
    { name: "Avocado", qty: "1 ripe" },
    { name: "Lime", qty: "1 wedge" },
    { name: "Cumin, chili & garlic powder", qty: "to taste", staple: true },
  ],
  steps: [
    "Drain and rinse the black beans. In a small bowl, mash about half with a fork, then mix in the rest. Season with cumin, chili powder, garlic powder, and a pinch of salt.",
    "Drain the canned corn and stir a few spoonfuls into the bean mixture.",
    "Halve the avocado and scoop the flesh into a small bowl. Squeeze in juice from one lime wedge, add a pinch of salt, and mash until smooth. Set aside as your dipping crema.",
    "Lay the tortilla flat. Spread the bean-and-corn mixture over half, then top with a generous handful of shredded cheese. Fold in half.",
    "Heat a skillet over medium with a light film of oil. Cook the quesadilla 3–4 min until golden, then flip and cook 2–3 min more until crisp and the cheese has melted.",
    "Slide onto a cutting board, rest 1 min, then cut into wedges. Serve with the avocado crema.",
  ],
};

/* small inline chevron (Icon set has no chevron) */
function TodayChevron({ dir = "left", size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d={dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

/* ===================================================================== */
function TodayCook({ wide = false }) {
  const m = TODAY_MEAL;
  const todayIdx = 0; // Thu, Jun 4 is day 1 of the plan
  const [active, setActive] = React.useState(todayIdx);
  const day = WEEK[active];

  const [doneSteps, setDoneSteps] = React.useState(() => new Set());
  const [gathered, setGathered] = React.useState(() => new Set());
  const [servings, setServings] = React.useState(m.servings);
  const [made, setMade] = React.useState(false);
  const [stars, setStars] = React.useState(0);
  // each day starts fresh
  React.useEffect(() => { setMade(false); setStars(0); setDoneSteps(new Set()); setGathered(new Set()); }, [active]);

  const toggle = (set, updater, key) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    updater(next);
  };
  // first not-yet-done step is the "current" one
  const currentStep = m.steps.findIndex((_, i) => !doneSteps.has(i));
  const doneCount = doneSteps.size;
  const allDone = doneCount === m.steps.length;

  /* ---- day stepper rail ---- */
  const DayRail = () => (
    <div style={{ display: "flex", gap: "var(--space-2)", overflow: "hidden" }}>
      {WEEK.map((d, i) => {
        const isToday = i === todayIdx;
        const isActive = i === active;
        const isPast = i < todayIdx;
        return (
          <button key={d.date} onClick={() => setActive(i)}
            aria-current={isActive ? "true" : undefined}
            style={{
              flex: "1 1 0", minWidth: 0, cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              padding: "8px 2px 7px", borderRadius: "var(--radius-md)",
              border: isActive ? "1px solid var(--c-primary)" : "1px solid transparent",
              background: isActive ? "var(--c-primary)" : (isPast ? "transparent" : "var(--c-surface-2)"),
              color: isActive ? "var(--c-on-primary)" : (isPast ? "var(--c-text-muted)" : "var(--c-text)"),
              opacity: isPast ? 0.55 : 1, transition: "background .15s, color .15s",
            }}>
            <span className="wm-caption" style={{ textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 700, opacity: isActive ? 0.85 : 0.6 }}>{d.wd}</span>
            <span style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: 18, lineHeight: 1 }}>{d.date}</span>
            {isPast
              ? <TodayIcon name="check" size={11} strokeWidth={3} color="var(--c-text-muted)" />
              : <span style={{ fontSize: 11, lineHeight: 1 }}>{d.wx}</span>}
            {isToday && <span style={{ width: 4, height: 4, borderRadius: 4, background: isActive ? "var(--c-on-primary)" : "var(--c-accent)" }} />}
          </button>
        );
      })}
    </div>
  );

  const Meta = () => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", alignItems: "center" }}>
      {[["clock", `${m.prep + m.cook} min`], ["flame", `~${m.kcal} kcal`]].map(([ic, tx]) => (
        <span key={tx} className="wm-bodysm" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--c-text)" }}>
          <TodayIcon name={ic} size={15} color="var(--c-primary)" /> {tx}
        </span>
      ))}
      <span className="wm-tag wm-tag--effort">
        <span style={{ letterSpacing: 1 }}>{"●".repeat(m.difficulty) + "○".repeat(5 - m.difficulty)}</span>&nbsp;{m.difficultyLabel}
      </span>
      {/* serving stepper */}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
        <TodayIcon name="users" size={15} color="var(--c-primary)" />
        <button onClick={() => setServings((s) => Math.max(1, s - 1))} className="today-step-btn" aria-label="Fewer servings">−</button>
        <span className="wm-body" style={{ fontWeight: 700, minWidth: 18, textAlign: "center" }}>{servings}</span>
        <button onClick={() => setServings((s) => s + 1)} className="today-step-btn" aria-label="More servings">+</button>
      </span>
    </div>
  );

  const Ingredients = () => (
    <div>
      <p className="wm-label wm-muted" style={{ marginBottom: "var(--space-3)" }}>Gather · {gathered.size}/{m.ingredients.length}</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "var(--space-1)" }}>
        {m.ingredients.map((ing, i) => {
          const on = gathered.has(i);
          return (
            <li key={ing.name}>
              <button onClick={() => toggle(gathered, setGathered, i)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "var(--space-3)", minHeight: 46,
                  background: "transparent", border: "none", borderBottom: "1px dashed var(--c-border)", cursor: "pointer", textAlign: "left", padding: "var(--space-1) 0" }}>
                <span className="wm-check" data-checked={on} style={{ pointerEvents: "none" }}>
                  {on && <TodayIcon name="check" size={14} color="var(--c-on-primary)" strokeWidth={2.6} />}
                </span>
                <span className="wm-body" style={{ flex: 1, textDecoration: on ? "line-through" : "none", color: on ? "var(--c-text-muted)" : "var(--c-text)" }}>
                  {ing.name}
                  {ing.staple && <span className="wm-tag wm-tag--est" style={{ marginLeft: 6, padding: "2px 7px" }}>staple</span>}
                </span>
                <span className="wm-bodysm wm-muted" style={{ flexShrink: 0 }}>{ing.qty}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  const Steps = () => (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-3)" }}>
        <p className="wm-label wm-muted">Cook · {doneCount}/{m.steps.length} steps</p>
        {/* progress bar */}
        <span style={{ flex: 1, maxWidth: 160, height: 5, marginLeft: 12, background: "var(--c-surface-2)", borderRadius: 4, overflow: "hidden" }}>
          <span style={{ display: "block", height: "100%", width: `${(doneCount / m.steps.length) * 100}%`, background: "var(--c-primary)", transition: "width .2s" }} />
        </span>
      </div>
      {doneCount === 0 && <p className="wm-caption wm-muted" style={{ marginTop: -4, marginBottom: "var(--space-3)" }}>Tap a step to mark your place as you cook</p>}
      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "var(--space-2)" }}>
        {m.steps.map((st, i) => {
          const done = doneSteps.has(i);
          const isCurrent = i === currentStep;
          return (
            <li key={i}>
              <button onClick={() => toggle(doneSteps, setDoneSteps, i)}
                style={{ width: "100%", textAlign: "left", cursor: "pointer", display: "flex", gap: "var(--space-3)", alignItems: "flex-start",
                  padding: "var(--space-3) var(--space-4)", borderRadius: "var(--radius-md)",
                  border: `1px solid ${isCurrent ? "var(--c-primary)" : "var(--c-border)"}`,
                  background: isCurrent ? "var(--c-primary-tint)" : (done ? "transparent" : "var(--c-surface)"),
                  boxShadow: isCurrent ? "var(--elev-1)" : "none", transition: "background .15s, border-color .15s" }}>
                <span style={{ flexShrink: 0, width: 28, height: 28, borderRadius: "var(--radius-pill)",
                  background: done ? "var(--c-primary)" : (isCurrent ? "var(--c-primary)" : "var(--c-surface-2)"),
                  color: done || isCurrent ? "var(--c-on-primary)" : "var(--c-text-muted)",
                  display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13, fontFamily: "var(--font-sans)" }}>
                  {done ? <TodayIcon name="check" size={15} color="var(--c-on-primary)" strokeWidth={2.6} /> : i + 1}
                </span>
                <span className={wide ? "wm-bodylg" : "wm-body"} style={{ paddingTop: 3, color: done ? "var(--c-text-muted)" : "var(--c-text)", textDecoration: done ? "line-through" : "none", textDecorationColor: "var(--c-border)" }}>{st}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );

  return (
    <div className="wm" style={{ minHeight: "100%", background: "var(--c-bg)", display: "flex", flexDirection: "column" }}>
      {/* injected once: serving stepper buttons */}
      <style>{`
        .today-step-btn{width:30px;height:30px;border-radius:var(--radius-sm);border:1px solid var(--c-border);background:var(--c-surface);color:var(--c-primary);font-size:18px;font-weight:700;line-height:1;cursor:pointer;display:grid;place-items:center;font-family:var(--font-sans)}
        .today-step-btn:hover{background:var(--c-surface-2);border-color:var(--c-primary)}
      `}</style>

      {/* ---- DAY BAR (sticky-feel header) ---- */}
      <div style={{ background: "var(--c-surface)", borderBottom: "1px solid var(--c-border)", padding: "var(--space-4) var(--space-5)", boxShadow: "var(--elev-1)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-3)" }}>
          <div>
            <p className="wm-label" style={{ color: "var(--c-primary)" }}>{active === todayIdx ? "Tonight" : (active < todayIdx ? "Earlier" : "Upcoming")}</p>
            <h1 className="wm-h1" style={{ marginTop: 2, whiteSpace: "nowrap" }}>{day.wd}, Jun {day.date}</h1>
          </div>
          <span className="wm-tag" style={{ gap: 6, fontSize: "var(--t-bodysm-size)", padding: "8px 12px" }}>
            <span style={{ fontSize: 15 }}>{day.wx}</span> {day.temp}F
          </span>
        </div>
        {/* prev / rail / next */}
        <div style={{ display: "flex", alignItems: "stretch", gap: "var(--space-2)" }}>
          <button onClick={() => setActive((a) => Math.max(0, a - 1))} disabled={active === 0}
            className="wm-btn wm-btn--ghost" style={{ minHeight: 0, padding: "0 var(--space-2)", opacity: active === 0 ? 0.35 : 1 }} aria-label="Previous day">
            <TodayChevron dir="left" size={18} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}><DayRail /></div>
          <button onClick={() => setActive((a) => Math.min(WEEK.length - 1, a + 1))} disabled={active === WEEK.length - 1}
            className="wm-btn wm-btn--ghost" style={{ minHeight: 0, padding: "0 var(--space-2)", opacity: active === WEEK.length - 1 ? 0.35 : 1 }} aria-label="Next day">
            <TodayChevron dir="right" size={18} />
          </button>
        </div>
      </div>

      {/* ---- RECIPE BODY ---- */}
      <div style={{ flex: 1, padding: "var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        <div>
          <span className="wm-tag wm-tag--cuisine">{m.cuisine}</span>
          <h2 className="wm-h2" style={{ marginTop: "var(--space-3)", fontSize: wide ? 24 : 21, lineHeight: wide ? "30px" : "27px" }}>{m.name}</h2>
          <p className="wm-bodysm wm-muted" style={{ marginTop: "var(--space-2)" }}>{m.description}</p>
          <div style={{ marginTop: "var(--space-4)" }}><Meta /></div>
        </div>

        <hr className="wm-divider" style={{ margin: 0 }} />

        {wide ? (
          <div style={{ display: "grid", gridTemplateColumns: "0.85fr 1.25fr", gap: "var(--space-7)", alignItems: "start" }}>
            <Ingredients />
            <Steps />
          </div>
        ) : (
          <div style={{ display: "grid", gap: "var(--space-6)" }}>
            <Ingredients />
            <Steps />
          </div>
        )}
      </div>

      {/* ---- ACTION BAR / RATING (footer) ---- */}
      {!made ? (
        <div style={{ position: "sticky", bottom: 0, background: "var(--c-surface)", borderTop: "1px solid var(--c-border)", padding: "var(--space-4) var(--space-5)", display: "flex", gap: "var(--space-3)", boxShadow: "0 -2px 10px rgba(var(--c-shadow) / 0.05)" }}>
          <button onClick={() => setMade(true)} className={`wm-btn ${allDone ? "wm-btn--primary" : "wm-btn--secondary"}`} style={{ flex: 1 }}>
            <TodayIcon name="check" size={17} strokeWidth={2.4} /> {allDone ? "Made it — log dinner" : "Mark as made"}
          </button>
          {active < WEEK.length - 1 && (
            <button onClick={() => setActive((a) => a + 1)} className="wm-btn wm-btn--ghost" style={{ flex: "0 0 auto" }}>
              Next day <TodayChevron dir="right" size={16} />
            </button>
          )}
        </div>
      ) : (
        <div style={{ position: "sticky", bottom: 0, background: "var(--c-surface)", borderTop: "1px solid var(--c-border)", padding: "var(--space-4) var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-3)", boxShadow: "0 -2px 10px rgba(var(--c-shadow) / 0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <span style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--c-success-bg)", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <TodayIcon name="check" size={19} color="var(--c-success-text)" strokeWidth={2.6} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="wm-h3">Logged for {day.wd}, Jun {day.date}</p>
              <p className="wm-bodysm wm-muted">{stars ? "Thanks — that helps us tune next week." : "How was it? Rate it so we learn your taste."}</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <TodayStars value={stars} onChange={setStars} />
            {stars > 0 && (
              <span className="wm-bodysm" style={{ color: "var(--c-primary)", fontWeight: 700 }}>
                {stars >= 4 ? "More like this →" : stars === 3 ? "Noted — it was fine" : "We’ll show it less ↓"}
              </span>
            )}
          </div>
          {active < WEEK.length - 1 && (
            <button onClick={() => setActive((a) => a + 1)} className="wm-btn wm-btn--primary" style={{ width: "100%" }}>
              On to {WEEK[active + 1].wd}, Jun {WEEK[active + 1].date} <TodayChevron dir="right" size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { TodayCook });
