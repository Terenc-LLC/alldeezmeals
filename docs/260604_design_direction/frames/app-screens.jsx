/* app-screens.jsx — ALLDEEZMeals Planning + Shopping List (final brand)
   Reuses TodayIcon (global from today-components.jsx). All type is the page's
   Plus Jakarta Sans via the --font-* overrides. Exports PlanningView, ShoppingList. */

/* ---- small inline icons not in TodayIcon ---- */
function AppMiniIcon({ name, size = 16, color = "currentColor", sw = 1.8 }) {
  const p = {
    copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
    cart: <><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h2.5l2.2 12.4a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.2L21 7H5.2" /></>,
    swap: <><path d="M4 7h13l-3-3" /><path d="M20 17H7l3 3" /></>,
    pin: <><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10Z" /><circle cx="12" cy="11" r="2.2" /></>,
  }[name];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>{p}</svg>
  );
}

/* the planned week (mirrors Setup + Meals screens) */
const PLAN_WEEK = [
  { wd: "Thu", date: 4, wx: "⛅", hilo: "86/58", cond: "Partly cloudy", ppl: 1, cuisine: "Any", temp: "Either", effort: "Any effort", cuisineTag: "Mexican", meal: "Smoky Black Bean & Cheese Quesadillas", desc: "Crispy tortillas, smoky black beans, melted cheese — with avocado crema.", prep: 8, cook: 10, serves: 1 },
  { wd: "Fri", date: 5, wx: "🌧️", hilo: "85/67", cond: "Rain", ppl: 3, cuisine: "Italian", temp: "Hot", effort: "Simple or less", cuisineTag: "Italian", meal: "Baked Penne with Meat Sauce", desc: "Seasoned ground beef and marinara, baked under melted mozzarella.", prep: 10, cook: 30, serves: 3 },
  { wd: "Sat", date: 6, wx: "⛈️", hilo: "85/68", cond: "Thunderstorm", ppl: 3, cuisine: "BBQ", temp: "Hot", effort: "Simple or less", cuisineTag: "BBQ", meal: "BBQ Pulled Chicken Sandwiches", desc: "Saucy pulled chicken piled on toasted buns with quick slaw.", prep: 10, cook: 20, serves: 3 },
  { wd: "Sun", date: 7, wx: "☀️", hilo: "88/70", cond: "Sunny", ppl: 3, cuisine: "Asian", temp: "Either", effort: "Any effort", cuisineTag: "Asian", meal: "Teriyaki Chicken Rice Bowls", desc: "Glazed teriyaki chicken over rice with crisp vegetables.", prep: 15, cook: 20, serves: 3 },
  { wd: "Mon", date: 8, wx: "☀️", hilo: "90/72", cond: "Sunny", ppl: 3, cuisine: "Salad-forward", temp: "Cold", effort: "Simple or less", cuisineTag: "Salad", meal: "Southwest Chicken Salad", desc: "Greens, chicken, avocado, black beans, and a lime-cilantro dressing.", prep: 15, cook: 10, serves: 3 },
  { wd: "Tue", date: 9, wx: "⛅", hilo: "84/66", cond: "Partly cloudy", ppl: 3, cuisine: "American", temp: "Either", effort: "Any effort", cuisineTag: "American", meal: "Classic American Burgers with Oven Fries", desc: "Juicy burgers and crispy oven fries — a weeknight crowd-pleaser.", prep: 15, cook: 25, serves: 3 },
  { wd: "Wed", date: 10, wx: "🌧️", hilo: "72/58", cond: "Rain", ppl: 3, cuisine: "Comfort food", temp: "Hot", effort: "Any effort", cuisineTag: "Comfort food", meal: "Beef & Vegetable Stew with Crusty Bread", desc: "A cozy, slow-simmered stew for a cool, rainy night.", prep: 20, cook: 60, serves: 3 },
];

/* ===================================================================== */
/* PLANNING — Setup + Meals as one flow                                  */
/* ===================================================================== */
function PlanningView({ initial = "setup" }) {
  const [sub, setSub] = React.useState(initial);
  const SubTab = ({ id, label, n }) => (
    <button onClick={() => setSub(id)}
      style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 14, cursor: "pointer",
        padding: "10px 14px", borderRadius: 10, border: "none",
        background: sub === id ? "var(--c-surface)" : "transparent",
        color: sub === id ? "var(--c-primary)" : "var(--c-text-muted)",
        boxShadow: sub === id ? "0 1px 3px rgba(26,58,52,.12)" : "none" }}>
      <span style={{ width: 20, height: 20, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800,
        background: sub === id ? "var(--c-primary)" : "var(--c-surface-2)", color: sub === id ? "#fff" : "var(--c-text-muted)" }}>{n}</span>
      {label}
    </button>
  );
  return (
    <div className="wm" style={{ background: "var(--c-bg)", minHeight: "100%", padding: "var(--space-5)" }}>
      <div style={{ marginBottom: "var(--space-3)" }}>
        <p className="wm-label" style={{ color: "var(--c-primary)" }}>Planning</p>
        <h1 className="wm-h1" style={{ marginTop: 2 }}>Plan your week</h1>
        <p className="wm-bodysm wm-muted" style={{ marginTop: 4 }}>Set it up, then review what we generated — two steps, one place.</p>
      </div>
      <div style={{ display: "flex", gap: 4, background: "var(--c-surface-2)", borderRadius: 12, padding: 5, marginBottom: "var(--space-5)" }}>
        <SubTab id="setup" label="Setup" n="1" />
        <SubTab id="meals" label="Meals" n="2" />
      </div>
      {sub === "setup" ? <SetupPane /> : <MealsPane />}
    </div>
  );
}

function SetupField({ label, children }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <p className="wm-field-label" style={{ marginBottom: 6 }}>{label}</p>
      {children}
    </div>
  );
}

function SetupDayRow({ d, first }) {
  const [skip, setSkip] = React.useState(false);
  const [note, setNote] = React.useState("");
  return (
    <div style={{ padding: "var(--space-3) 0", borderTop: first ? "none" : "1px solid var(--c-border)", opacity: skip ? 0.7 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-2)", gap: 10, flexWrap: "wrap" }}>
        <span className="wm-body" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{d.wd}, Jun {d.date}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span className="wm-bodysm wm-muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 14 }}>{d.wx}</span> {d.hilo}F · {d.cond}
          </span>
          <button onClick={() => setSkip((s) => !s)} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            <span className="wm-check" data-checked={skip} style={{ width: 20, height: 20, pointerEvents: "none" }}>
              {skip && <TodayIcon name="check" size={12} color="#fff" strokeWidth={2.6} />}
            </span>
            <span className="wm-bodysm" style={{ fontWeight: 700, color: skip ? "var(--c-primary)" : "var(--c-text-muted)" }}>Skip day</span>
          </button>
        </div>
      </div>
      {skip ? (
        <p className="wm-bodysm wm-muted" style={{ fontStyle: "italic" }}>No dinner this day — we’ll leave {d.wd} off the plan and the shopping list.</p>
      ) : (
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <div className="wm-input" style={{ width: 58, flex: "0 0 auto", display: "flex", alignItems: "center", gap: 4 }}>{d.ppl}<span className="wm-caption wm-muted">ppl</span></div>
            <div className="wm-select" style={{ flex: 1, minWidth: 120, display: "flex", alignItems: "center" }}>{d.cuisine}</div>
            <div className="wm-select" style={{ width: 96, flex: "0 0 auto", display: "flex", alignItems: "center" }}>{d.temp}</div>
            <div className="wm-select" style={{ width: 140, flex: "0 0 auto", display: "flex", alignItems: "center" }}>{d.effort}</div>
          </div>
          <input className="wm-input" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note for this day (optional) — e.g. “use up the leftover chicken”, “keep it quick”" />
        </div>
      )}
    </div>
  );
}

function SetupPane() {
  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      <div className="wm-card">
        <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
          <SetupField label="Start date"><div className="wm-input" style={{ display: "flex", alignItems: "center" }}>06/04/2026</div></SetupField>
          <SetupField label="Days"><div className="wm-select" style={{ display: "flex", alignItems: "center" }}>7</div></SetupField>
          <SetupField label="People"><div className="wm-input" style={{ display: "flex", alignItems: "center" }}>3</div></SetupField>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "var(--space-4)" }}>
          <AppMiniIcon name="pin" size={16} color="var(--c-primary)" />
          <span className="wm-body" style={{ fontWeight: 700 }}>Bloomfield, IA</span>
          <span className="wm-bodysm wm-muted">· change location</span>
        </div>
      </div>

      <div className="wm-card">
        <h3 className="wm-h3">Your week</h3>
        <p className="wm-bodysm wm-muted" style={{ marginTop: 2, marginBottom: "var(--space-3)" }}>Forecast auto-fills. <strong>Temp = Auto</strong> adapts the dish to the weather.</p>
        <div>
          {PLAN_WEEK.map((d, i) => <SetupDayRow key={d.date} d={d} first={i === 0} />)}
        </div>
      </div>

      <button className="wm-btn wm-btn--primary wm-btn--block">Generate this week →</button>
    </div>
  );
}

function MealCard({ d }) {
  const [vote, setVote] = React.useState(null);
  return (
    <div className="wm-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span className="wm-caption wm-muted" style={{ textTransform: "uppercase", letterSpacing: ".04em" }}>{d.wd}, Jun {d.date} · {d.ppl} ppl · <span style={{ fontSize: 12 }}>{d.wx}</span> {d.hilo.split("/")[0]}F</span>
        <span className="wm-tag" style={{ background: "var(--c-success-bg)", color: "var(--c-success-text)", fontWeight: 700 }}>
          <TodayIcon name="check" size={12} color="var(--c-success-text)" strokeWidth={2.6} /> Accepted
        </span>
      </div>
      <h3 className="wm-h3" style={{ fontSize: 17 }}>{d.meal}</h3>
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0 6px", flexWrap: "wrap" }}>
        <span className="wm-tag wm-tag--cuisine">{d.cuisineTag}</span>
        <span className="wm-bodysm wm-muted">{d.desc}</span>
      </div>
      <p className="wm-bodysm wm-muted">Prep {d.prep} min · Cook {d.cook} min · Serves {d.serves}</p>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
        <button className="wm-btn wm-btn--secondary wm-btn--sm"><AppMiniIcon name="swap" size={15} color="var(--c-primary)" /> Swap</button>
        <span style={{ flex: 1 }} />
        <button onClick={() => setVote(vote === "up" ? null : "up")} className="wm-btn wm-btn--ghost wm-btn--sm" style={{ padding: "0 10px", borderColor: vote === "up" ? "var(--c-primary)" : "var(--c-border)", color: vote === "up" ? "var(--c-primary)" : "var(--c-text-muted)" }}>👍</button>
        <button onClick={() => setVote(vote === "down" ? null : "down")} className="wm-btn wm-btn--ghost wm-btn--sm" style={{ padding: "0 10px", borderColor: vote === "down" ? "var(--c-danger)" : "var(--c-border)" }}>👎</button>
        <button className="wm-btn wm-btn--ghost wm-btn--sm" style={{ padding: "0 10px" }}><TodayIcon name="star" size={15} /></button>
      </div>
    </div>
  );
}

function MealsPane() {
  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
        <span className="wm-bodysm wm-muted">7 of 7 dinners accepted</span>
        <span className="wm-bodysm" style={{ color: "var(--c-primary)", fontWeight: 700 }}>Regenerate all ↻</span>
      </div>
      {PLAN_WEEK.map((d) => <MealCard key={d.date} d={d} />)}
    </div>
  );
}

/* ===================================================================== */
/* SHOPPING LIST                                                         */
/* ===================================================================== */
const SHOP_ALWAYS = ["Salt", "Pepper", "Olive oil", "Garlic", "Cumin", "Chili powder"];
const SHOP_CATS = [
  { cat: "Produce", items: [
    { n: "Avocado", q: "2-count bag" }, { n: "Carrots", q: "2 lb bag" }, { n: "Celery", q: "1 head" },
    { n: "Fresh broccoli florets", q: "12 oz" }, { n: "Lime", q: "1 lb bag" }, { n: "Romaine hearts", q: "3-count" },
    { n: "Russet potatoes", q: "2 × 5 lb" }, { n: "Tomato", q: "1 loose" },
  ] },
  { cat: "Meat & Seafood", items: [
    { n: "Ground beef (85% lean)", q: "1 lb" }, { n: "Chicken thighs", q: "2.5 lb" }, { n: "Chicken breast", q: "1.5 lb" },
  ] },
  { cat: "Pantry", items: [
    { n: "Black beans", q: "1 can" }, { n: "Canned corn", q: "1 can" }, { n: "Marinara sauce", q: "24 oz jar" },
    { n: "Penne pasta", q: "16 oz" }, { n: "BBQ sauce", q: "18 oz" },
  ] },
  { cat: "Dairy & Bakery", items: [
    { n: "Shredded Mexican blend cheese", q: "8 oz" }, { n: "Mozzarella", q: "8 oz" }, { n: "Burger buns", q: "8-count" },
  ] },
];

function ShoppingRow({ id, item, checked, has, onCheck, onHave }) {
  return (
    <div className="wm-listrow" data-checked={checked} style={{ borderBottom: "1px solid var(--c-surface-2)" }}>
      <button className="wm-check" data-checked={checked} aria-label="Toggle" onClick={onCheck}>
        {checked && <TodayIcon name="check" size={14} color="var(--c-on-primary)" strokeWidth={2.6} />}
      </button>
      <span className="wm-listrow__label">
        <span className="wm-body wm-listrow__name" style={{ fontWeight: 600 }}>{item.n}</span>
        <span className="wm-bodysm wm-muted">&nbsp;· {item.q}</span>
      </span>
      <button onClick={onHave} className="wm-tag" style={{ border: "1px solid", borderColor: has ? "var(--c-primary)" : "var(--c-border)", background: has ? "var(--c-primary)" : "transparent", color: has ? "#fff" : "var(--c-text-muted)", cursor: "pointer", fontWeight: 700 }}>have it</button>
    </div>
  );
}

function ShoppingList() {
  const [checked, setChecked] = React.useState(() => new Set());
  const [have, setHave] = React.useState(() => new Set());
  const tog = (set, upd, k) => { const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); upd(n); };
  const total = SHOP_CATS.reduce((s, c) => s + c.items.length, 0);
  return (
    <div className="wm" style={{ background: "var(--c-bg)", minHeight: "100%", padding: "var(--space-5)" }}>
      <div style={{ marginBottom: "var(--space-4)" }}>
        <h1 className="wm-h1">Shopping list</h1>
        <p className="wm-bodysm wm-muted" style={{ marginTop: 2 }}>{total} items · 7/7 dinners + staples</p>
      </div>
      <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-4)", flexWrap: "wrap" }}>
        <button className="wm-btn wm-btn--primary"><AppMiniIcon name="copy" size={16} color="#fff" /> Copy list</button>
        <button className="wm-btn wm-btn--secondary"><AppMiniIcon name="cart" size={16} color="var(--c-primary)" /> Instacart (AI)</button>
      </div>

      <div className="wm-sunken" style={{ marginBottom: "var(--space-4)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-2)" }}>
          <span className="wm-h3" style={{ color: "var(--c-primary)", fontSize: 15, display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", flexShrink: 0 }}>
            <TodayIcon name="star" size={15} color="var(--c-accent)" fill="var(--c-accent)" /> Always have
          </span>
          <span className="wm-caption wm-muted">auto-excluded weekly</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
          {SHOP_ALWAYS.map((t) => <span key={t} className="wm-tag wm-tag--primary" style={{ whiteSpace: "nowrap" }}>{t}</span>)}
        </div>
      </div>

      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        {SHOP_CATS.map((c) => (
          <div key={c.cat} className="wm-card">
            <h3 className="wm-h3" style={{ color: "var(--c-primary)", fontSize: 15, borderBottom: "1px solid var(--c-border)", paddingBottom: "var(--space-2)", marginBottom: "var(--space-1)" }}>{c.cat}</h3>
            <div>
              {c.items.map((it) => {
                const k = c.cat + "/" + it.n;
                return <ShoppingRow key={k} item={it} checked={checked.has(k)} has={have.has(k)}
                  onCheck={() => tog(checked, setChecked, k)} onHave={() => tog(have, setHave, k)} />;
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: "var(--space-4)", padding: "var(--space-3) var(--space-4)", background: "var(--c-success-bg)", border: "1px solid var(--c-border)", borderRadius: "var(--radius-md)" }}>
        <span className="wm-body" style={{ color: "var(--c-success-text)", fontWeight: 700 }}>Est. $58.40</span>
        <span className="wm-bodysm wm-muted"> — recent prices, not a quote</span>
      </div>
    </div>
  );
}

Object.assign(window, { PlanningView, ShoppingList });
