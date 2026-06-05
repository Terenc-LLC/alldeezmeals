/* today-v2.jsx — ALLDEEZMeals "Today" — design pass v2
   Key changes:
   - Provenance note: info callout above recipe identity
   - GATHER: two groups ("Prepared earlier this week" / "Remaining ingredients")
   - Pantry badge on applicable ingredients

   Token notes (no new tokens introduced):
   - Provenance:     bg var(--c-surface), border 1px var(--c-border), left-accent 3px var(--c-primary)
   - Prepared header: bg var(--c-primary-tint) (#E4F0EC), text/icon var(--c-primary)
   - Prepared body:  bg rgba(228,240,236,.30) — primary-tint at 30%, border rgba(43,140,126,.18)
   - Pantry badge:   bg var(--c-warning-bg), color var(--c-warning) — same vars as .wm-tag--est
                     but smaller (10px / 600) and lowercase "pantry"

   Self-contained — does not depend on today-components.jsx.
   Exports: TodayCookV2 */

function TodayIconV2({ name, size = 16, color = "currentColor", sw = 1.8, fill = "none", style }) {
  const p = {
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    users: <><path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1"/><circle cx="9" cy="7" r="3.2"/></>,
    flame: <path d="M12 22c4 0 7-2.7 7-6.5 0-3-2-5.3-3.3-7.2-.3 1.8-1.4 2.7-2.2 2.7C12 8 13 4 9.5 2c.5 3-2 4.5-3.2 6.6C5.5 10 5 12 5 14c0 4.2 3.3 8 7 8Z"/>,
    check: <path d="M4 12.5l5 5 11-11"/>,
    star:  <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.8 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9 2.9-6Z"/>,
    info:  <><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><circle cx="12" cy="16.5" r=".75" fill="currentColor"/></>,
  }[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color}
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}>{p}</svg>
  );
}

function TodayChevV2({ dir = "left", size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d={dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

function TodayStarsV2({ value = 0, onChange }) {
  const [hover, setHover] = React.useState(0);
  return (
    <div style={{ display: "flex", gap: 4 }} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map(n => {
        const on = (hover || value) >= n;
        return (
          <button key={n} onClick={() => onChange(n)} onMouseEnter={() => setHover(n)}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 2, lineHeight: 0 }}>
            <TodayIconV2 name="star" size={28}
              color={on ? "var(--c-accent)" : "var(--c-border)"}
              fill={on ? "var(--c-accent)" : "none"} sw={1.6} />
          </button>
        );
      })}
    </div>
  );
}

/* ---- Week ---- */
const WEEK_V2 = [
  { wd: "Thu", date: 4,  wx: "⛅",  temp: "86°" },
  { wd: "Fri", date: 5,  wx: "🌧️", temp: "85°" },
  { wd: "Sat", date: 6,  wx: "⛈️", temp: "85°" },
  { wd: "Sun", date: 7,  wx: "☀️",  temp: "88°" },
  { wd: "Mon", date: 8,  wx: "☀️",  temp: "90°" },
  { wd: "Tue", date: 9,  wx: "⛅",  temp: "84°" },
  { wd: "Wed", date: 10, wx: "🌧️", temp: "72°" },
];
const TODAY_IDX_V2 = 4; // Mon, Jun 8 — illustrates chicken reused from Sat

/* ---- Meal — demonstrates both GATHER groups and pantry badges ---- */
const MEAL_V2 = {
  name:        "Southwest Chicken Salad",
  cuisine:     "Salad",
  description: "Crisp romaine, black beans, corn, and avocado over Saturday's pulled chicken — quick lime-cumin drizzle.",
  prep: 15, cook: 0, servings: 3, kcal: 520,
  effort: 1, effortLabel: "Simple",
  provenance:  "The chicken breast is already cooked — you made it Saturday and it's sitting in the fridge. This meal is mostly assembly; dinner is on the table in about 15 minutes.",
  prepared: [
    /* name, qty, note (shown right of checkbox, pre-done source reminder) */
    { name: "Cooked chicken breast", qty: "1½ cups, shredded", note: "Sat · in the fridge" },
  ],
  remaining: [
    { name: "Romaine hearts",      qty: "½ head, chopped" },
    { name: "Black beans",         qty: "½ can, drained",   pantry: true },
    { name: "Canned corn",         qty: "3 tbsp",           pantry: true },
    { name: "Avocado",             qty: "1 ripe" },
    { name: "Lime",                qty: "½, juiced" },
    { name: "Cilantro",            qty: "small handful" },
    { name: "Olive oil",           qty: "1 tbsp",           pantry: true },
    { name: "Salt, pepper, cumin", qty: "to taste",         pantry: true },
  ],
  steps: [
    "Take the cooked chicken from the fridge. Shred into bite-sized pieces with two forks.",
    "Wash and chop the romaine. Drain and rinse the black beans and corn.",
    "Halve the avocado, scoop, and cut into rough chunks.",
    "Quick dressing: squeeze ½ lime into a small bowl, add 1 tbsp olive oil, a pinch of cumin and salt. Whisk to combine.",
    "Arrange the romaine in a large bowl. Scatter the beans, corn, avocado, and chicken on top.",
    "Drizzle with dressing, scatter the cilantro, toss gently. Taste for salt and lime. Serve right away.",
  ],
};

/* ========================================================= */
function TodayCookV2({ wide = false }) {
  const m = MEAL_V2;
  const [active,    setActive]    = React.useState(TODAY_IDX_V2);
  const [doneSteps, setDoneSteps] = React.useState(() => new Set());
  const [gathered,  setGathered]  = React.useState(() => new Set());
  const [servings,  setServings]  = React.useState(m.servings);
  const [made,      setMade]      = React.useState(false);
  const [stars,     setStars]     = React.useState(0);

  React.useEffect(() => {
    setMade(false); setStars(0); setDoneSteps(new Set()); setGathered(new Set());
  }, [active]);

  const tog = (set, upd, k) => {
    const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); upd(n);
  };
  const day         = WEEK_V2[active];
  const currentStep = m.steps.findIndex((_, i) => !doneSteps.has(i));
  const doneCount   = doneSteps.size;
  const allDone     = doneCount === m.steps.length;
  const totalIng    = m.prepared.length + m.remaining.length;

  /* --- DAY RAIL --- */
  function DayRail() {
    return (
      <div style={{ display: "flex", gap: "var(--space-2)", overflow: "hidden" }}>
        {WEEK_V2.map((d, i) => {
          const isActive = i === active;
          const isPast   = i < TODAY_IDX_V2;
          const isToday  = i === TODAY_IDX_V2;
          return (
            <button key={d.date} onClick={() => setActive(i)}
              style={{
                flex: "1 1 0", minWidth: 0, cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                padding: "8px 2px 7px", borderRadius: "var(--radius-md)",
                border: `1.5px solid ${isActive ? "var(--c-primary)" : "transparent"}`,
                background: isActive ? "var(--c-primary)" : isPast ? "transparent" : "var(--c-surface-2)",
                color: isActive ? "var(--c-on-primary)" : isPast ? "var(--c-text-muted)" : "var(--c-text)",
                opacity: isPast ? 0.55 : 1, transition: "background .15s",
              }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", opacity: .7 }}>{d.wd}</span>
              <span style={{ fontWeight: 600, fontSize: 18, lineHeight: 1 }}>{d.date}</span>
              {isPast
                ? <TodayIconV2 name="check" size={11} sw={3} color="var(--c-text-muted)" />
                : <span style={{ fontSize: 11, lineHeight: 1 }}>{d.wx}</span>}
              {isToday && (
                <span style={{ width: 4, height: 4, borderRadius: 4,
                  background: isActive ? "rgba(255,255,255,0.65)" : "var(--c-accent)" }} />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  /* --- INGREDIENT ROW (used in both groups) --- */
  function IngRow({ item, id, indented }) {
    const on = gathered.has(id);
    return (
      <li>
        <button onClick={() => tog(gathered, setGathered, id)}
          style={{
            width: "100%", display: "flex", alignItems: "center",
            gap: "var(--space-3)", minHeight: 50,
            background: "transparent", border: "none",
            borderBottom: "1px solid var(--c-border)",
            cursor: "pointer", textAlign: "left",
            padding: indented
              ? "var(--space-2) var(--space-3)"
              : "var(--space-2) 0",
          }}>
          {/* Checkbox */}
          <span className="wm-check" data-checked={on} style={{ pointerEvents: "none" }}>
            {on && <TodayIconV2 name="check" size={13} color="var(--c-on-primary)" sw={2.6} />}
          </span>
          {/* Name + pantry badge */}
          <span style={{ flex: 1, display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <span className="wm-body" style={{
              textDecoration: on ? "line-through" : "none",
              textDecorationColor: "var(--c-text-muted)",
              color: on ? "var(--c-text-muted)" : "var(--c-text)",
            }}>{item.name}</span>
            {item.pantry && !on && (
              <span style={{
                fontSize: 10, fontWeight: 600, lineHeight: 1,
                color: "var(--c-warning)", background: "var(--c-warning-bg)",
                padding: "2px 6px", borderRadius: "var(--radius-pill)",
                flexShrink: 0, whiteSpace: "nowrap",
              }}>pantry</span>
            )}
          </span>
          {/* Source note (prepared group only) */}
          {item.note && !on && (
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--c-primary)", opacity: .75, flexShrink: 0 }}>{item.note}</span>
          )}
          {/* Quantity */}
          <span className="wm-bodysm wm-muted" style={{ flexShrink: 0, textAlign: "right", minWidth: 68 }}>{item.qty}</span>
        </button>
      </li>
    );
  }

  /* --- GATHER SECTION --- */
  function GatherSection() {
    const hasPrepared = m.prepared.length > 0;
    return (
      <div>
        {/* Section header with combined progress */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-3)" }}>
          <p className="wm-label wm-muted">Gather</p>
          <span className="wm-caption wm-muted">{gathered.size} of {totalIng} gathered</span>
        </div>

        {/* ---- Group A: Prepared earlier ---- */}
        {hasPrepared && (
          <div style={{ marginBottom: "var(--space-4)" }}>
            {/* Group header — var(--c-primary-tint) bg */}
            <div style={{
              display: "flex", alignItems: "center", gap: "var(--space-2)",
              background: "var(--c-primary-tint)",
              padding: "var(--space-2) var(--space-3)",
              borderRadius: "var(--radius-md) var(--radius-md) 0 0",
            }}>
              <span style={{
                width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                background: "var(--c-primary)", display: "grid", placeItems: "center",
              }}>
                <TodayIconV2 name="check" size={10} color="var(--c-on-primary)" sw={2.8} />
              </span>
              <span style={{
                fontSize: "var(--t-label-size)", fontWeight: "var(--t-label-w)",
                letterSpacing: "var(--t-label-tracking)", textTransform: "uppercase",
                color: "var(--c-primary)",
              }}>Prepared earlier this week</span>
            </div>
            {/* Group body — soft tinted surface */}
            <div style={{
              border: "1px solid rgba(43,140,126,0.18)", borderTop: "none",
              borderRadius: "0 0 var(--radius-md) var(--radius-md)",
              overflow: "hidden",
              background: "rgba(228,240,236,0.30)", /* --c-primary-tint at 30% */
            }}>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {m.prepared.map((item, i) => (
                  <IngRow key={`prep-${i}`} item={item} id={`prep-${i}`} indented />
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* ---- Group B: Remaining ingredients ---- */}
        {hasPrepared && (
          <p style={{
            fontSize: "var(--t-label-size)", fontWeight: 700,
            letterSpacing: "var(--t-label-tracking)", textTransform: "uppercase",
            color: "var(--c-text-muted)", marginBottom: "var(--space-2)",
          }}>Remaining ingredients</p>
        )}
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {m.remaining.map((item, i) => (
            <IngRow key={`rem-${i}`} item={item} id={`rem-${i}`} />
          ))}
        </ul>
      </div>
    );
  }

  /* --- COOK SECTION --- */
  function CookSection() {
    return (
      <div>
        {/* Header + full-width progress bar */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
          <p className="wm-label wm-muted" style={{ flexShrink: 0 }}>Cook · {doneCount}/{m.steps.length}</p>
          <div style={{ flex: 1, height: 5, background: "var(--c-surface-2)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%", background: "var(--c-primary)", transition: "width .2s",
              width: `${(doneCount / m.steps.length) * 100}%`,
            }} />
          </div>
        </div>
        {doneCount === 0 && (
          <p className="wm-caption wm-muted" style={{ marginTop: -6, marginBottom: "var(--space-3)" }}>
            Tap a step to mark your place as you cook
          </p>
        )}
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: "var(--space-2)" }}>
          {m.steps.map((st, i) => {
            const done      = doneSteps.has(i);
            const isCurrent = i === currentStep;
            return (
              <li key={i}>
                <button onClick={() => tog(doneSteps, setDoneSteps, i)}
                  style={{
                    width: "100%", textAlign: "left", cursor: "pointer",
                    display: "flex", gap: "var(--space-3)", alignItems: "flex-start",
                    padding: `${isCurrent ? "var(--space-4)" : "var(--space-3)"} var(--space-4)`,
                    borderRadius: "var(--radius-md)",
                    border: `1.5px solid ${isCurrent ? "var(--c-primary)" : "var(--c-border)"}`,
                    background: isCurrent ? "var(--c-primary-tint)" : done ? "transparent" : "var(--c-surface)",
                    boxShadow: isCurrent ? "var(--elev-1)" : "none",
                    transition: "background .15s, border-color .15s",
                    minHeight: "var(--tap-min)",
                  }}>
                  <span style={{
                    flexShrink: 0, width: 28, height: 28, borderRadius: "var(--radius-pill)", marginTop: 2,
                    background: (done || isCurrent) ? "var(--c-primary)" : "var(--c-surface-2)",
                    color: (done || isCurrent) ? "var(--c-on-primary)" : "var(--c-text-muted)",
                    display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13,
                  }}>
                    {done ? <TodayIconV2 name="check" size={14} color="var(--c-on-primary)" sw={2.6} /> : i + 1}
                  </span>
                  <span className={wide ? "wm-bodylg" : "wm-body"} style={{
                    paddingTop: 4, color: done ? "var(--c-text-muted)" : "var(--c-text)",
                    textDecoration: done ? "line-through" : "none",
                    textDecorationColor: "var(--c-border)",
                    fontWeight: isCurrent ? 500 : 400,
                  }}>{st}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  /* ===== RENDER ===== */
  return (
    <div className="wm" style={{ height: "100%", background: "var(--c-bg)", display: "flex", flexDirection: "column" }}>
      <style>{`.tv2btn{width:30px;height:30px;border-radius:var(--radius-sm);border:1.5px solid var(--c-border);background:var(--c-surface);color:var(--c-primary);font-size:18px;font-weight:700;cursor:pointer;display:grid;place-items:center;font-family:var(--font-sans)}.tv2btn:hover{background:var(--c-surface-2)}`}</style>

      {/* ---- DAY BAR ---- */}
      <div style={{ background: "var(--c-surface)", borderBottom: "1px solid var(--c-border)",
        padding: "var(--space-4) var(--space-5)", boxShadow: "var(--elev-1)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "var(--space-3)" }}>
          <div>
            <p className="wm-label" style={{ color: "var(--c-primary)" }}>
              {active === TODAY_IDX_V2 ? "Tonight" : active < TODAY_IDX_V2 ? "Earlier" : "Upcoming"}
            </p>
            <h1 style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
              {day.wd}, Jun {day.date}
            </h1>
          </div>
          <span className="wm-tag" style={{ gap: 6, fontSize: 13, padding: "8px 12px", flexShrink: 0, marginTop: 2 }}>
            <span style={{ fontSize: 15 }}>{day.wx}</span> {day.temp}F
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "stretch", gap: "var(--space-2)" }}>
          <button onClick={() => setActive(a => Math.max(0, a - 1))} disabled={active === 0}
            className="wm-btn wm-btn--ghost"
            style={{ minHeight: 0, padding: "0 var(--space-2)", opacity: active === 0 ? 0.3 : 1 }}>
            <TodayChevV2 dir="left" size={18} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}><DayRail /></div>
          <button onClick={() => setActive(a => Math.min(6, a + 1))} disabled={active === 6}
            className="wm-btn wm-btn--ghost"
            style={{ minHeight: 0, padding: "0 var(--space-2)", opacity: active === 6 ? 0.3 : 1 }}>
            <TodayChevV2 dir="right" size={18} />
          </button>
        </div>
      </div>

      {/* ---- SCROLLABLE BODY ---- */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        <div style={{ padding: "var(--space-5)", display: "grid", gap: "var(--space-5)" }}>

          {/* Provenance note — 3px left-accent callout */}
          <div style={{
            display: "flex", gap: "var(--space-3)", alignItems: "flex-start",
            background: "var(--c-surface)", border: "1px solid var(--c-border)",
            borderLeft: "3px solid var(--c-primary)", borderRadius: "var(--radius-sm)",
            padding: "var(--space-3) var(--space-4)",
          }}>
            <TodayIconV2 name="info" size={15} color="var(--c-primary)" style={{ marginTop: 2 }} />
            <p className="wm-bodysm" style={{ margin: 0, lineHeight: "20px" }}>
              <strong style={{ fontWeight: 700 }}>Good to know · </strong>{m.provenance}
            </p>
          </div>

          {/* Recipe identity */}
          <div>
            <span className="wm-tag wm-tag--cuisine">{m.cuisine}</span>
            <h2 style={{ fontSize: wide ? 24 : 21, lineHeight: wide ? "30px" : "27px",
              fontWeight: 700, letterSpacing: "-0.01em",
              margin: "var(--space-3) 0 var(--space-2)" }}>{m.name}</h2>
            <p className="wm-bodysm wm-muted">{m.description}</p>
            {/* Meta row */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-4)", alignItems: "center", marginTop: "var(--space-4)" }}>
              {[["clock", `${m.prep || m.cook} min`], ["flame", `~${m.kcal} kcal`]].map(([ic, tx]) => (
                <span key={tx} className="wm-bodysm" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--c-text)" }}>
                  <TodayIconV2 name={ic} size={15} color="var(--c-primary)" /> {tx}
                </span>
              ))}
              <span className="wm-tag wm-tag--effort">
                <span style={{ letterSpacing: 1 }}>{"●".repeat(m.effort) + "○".repeat(5 - m.effort)}</span>&nbsp;{m.effortLabel}
              </span>
              {/* Serving stepper */}
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                <TodayIconV2 name="users" size={15} color="var(--c-primary)" />
                <button onClick={() => setServings(s => Math.max(1, s - 1))} className="tv2btn" aria-label="Fewer servings">−</button>
                <span className="wm-body" style={{ fontWeight: 700, minWidth: 18, textAlign: "center" }}>{servings}</span>
                <button onClick={() => setServings(s => s + 1)} className="tv2btn" aria-label="More servings">+</button>
              </span>
            </div>
          </div>

          <hr className="wm-divider" style={{ margin: 0 }} />

          {/* Gather + Cook — tablet: two cols, mobile: stacked */}
          {wide ? (
            <div style={{ display: "grid", gridTemplateColumns: "0.85fr 1.25fr", gap: "var(--space-7)", alignItems: "start" }}>
              <GatherSection /><CookSection />
            </div>
          ) : (
            <div style={{ display: "grid", gap: "var(--space-6)" }}>
              <GatherSection /><CookSection />
            </div>
          )}
        </div>
      </div>

      {/* ---- STICKY FOOTER ---- */}
      {!made ? (
        <div style={{ flexShrink: 0, background: "var(--c-surface)", borderTop: "1px solid var(--c-border)",
          padding: "var(--space-4) var(--space-5)", display: "flex", gap: "var(--space-3)",
          boxShadow: "0 -2px 10px rgba(var(--c-shadow)/0.05)" }}>
          <button onClick={() => setMade(true)}
            className={`wm-btn ${allDone ? "wm-btn--primary" : "wm-btn--secondary"}`} style={{ flex: 1 }}>
            <TodayIconV2 name="check" size={17} sw={2.4} />
            {allDone ? "Made it — log dinner" : "Mark as made"}
          </button>
          {active < 6 && (
            <button onClick={() => setActive(a => a + 1)} className="wm-btn wm-btn--ghost" style={{ flexShrink: 0 }}>
              Next <TodayChevV2 dir="right" size={16} />
            </button>
          )}
        </div>
      ) : (
        <div style={{ flexShrink: 0, background: "var(--c-surface)", borderTop: "1px solid var(--c-border)",
          padding: "var(--space-4) var(--space-5)", display: "flex", flexDirection: "column", gap: "var(--space-3)",
          boxShadow: "0 -2px 10px rgba(var(--c-shadow)/0.05)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <span style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--c-success-bg)",
              display: "grid", placeItems: "center", flexShrink: 0 }}>
              <TodayIconV2 name="check" size={19} color="var(--c-success-text)" sw={2.6} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="wm-h3" style={{ margin: 0 }}>Logged for {day.wd}, Jun {day.date}</p>
              <p className="wm-bodysm wm-muted" style={{ margin: 0, marginTop: 2 }}>
                {stars ? "Thanks — that helps us tune next week." : "How was it? Rate it so we learn your taste."}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <TodayStarsV2 value={stars} onChange={setStars} />
            {stars > 0 && (
              <span className="wm-bodysm" style={{ color: "var(--c-primary)", fontWeight: 700 }}>
                {stars >= 4 ? "More like this →" : stars === 3 ? "Noted — it was fine" : "We'll show it less ↓"}
              </span>
            )}
          </div>
          {active < 6 && (
            <button onClick={() => setActive(a => a + 1)} className="wm-btn wm-btn--primary" style={{ width: "100%" }}>
              On to {WEEK_V2[active + 1].wd}, Jun {WEEK_V2[active + 1].date} <TodayChevV2 dir="right" size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { TodayCookV2 });
