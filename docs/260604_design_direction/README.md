# Handoff: ALLDEEZMeals — Today, Planning & Shopping List

## Overview
ALLDEEZMeals is a weekly dinner planner whose pitch is **"a week of dinners, planned in minutes."** A user sets up their week (people, days, location, per-day preferences), the app generates dinners that adapt to the **weather** and **learn the user's taste**, produces a consolidated **budget grocery list** with an ingredient-reuse engine that minimizes waste, and then a **cook mode** walks them through tonight's recipe one step at a time.

This package covers a brand refresh + three core screens that form the loop **Plan → Shop → Cook**:
- **Today** (cook mode) — replaces the old "This Week" tab
- **Planning** — unifies the old "Setup" and "Meals" tabs into one flow
- **Shopping List** — re-skin of the old "List" tab

## About the Design Files
The files in this bundle are **design references created in HTML/React-via-Babel** — prototypes showing intended look and behavior, **not production code to copy directly**. The task is to **recreate these designs in the target codebase's existing environment** (the app is a React/TypeScript app — see `src/App.tsx` in the original project) using its established patterns, then wire them to real data and APIs.

The prototypes use inline-style objects + a small set of `wm-*` utility classes (see `warm-market.css`). The real app already uses a CSS-variable + inline-style approach, so the tokens map directly.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, radii, and interaction states are all specified below and in `warm-market.css`. Recreate the UI to match, using the codebase's component conventions. Sample content (recipes, the week of June 4–10, prices) is **placeholder** — wire to real data.

---

## Brand / Identity (locked)

### Logo — "D-Plate"
A clever, hidden-meaning mark: the letter **"D"** doubles as a plate, with a coral dot as the dish on it (the same dot is hidden in the "D" of the wordmark, FedEx/Amazon-style).
- **App icon (primary use):** reversed tile — solid teal rounded square, white "D", coral dot.
  - Tile: `border-radius: 27% of size`, background `--c-primary`.
  - "D": Plus Jakarta Sans **800**, white, font-size = `0.60 × tile size`.
  - Dot: coral `--c-accent` circle, diameter = `0.20 × glyph font-size`, positioned in the counter at `left: 57%, top: 53%` (translate -50%,-50%) relative to a tight-wrapping glyph span.
- **On light surfaces:** teal "D" on cream tile, same dot.
- **Monochrome fallback** (one-ink/stamp): single-color "D" (dot same color, effectively disappears).
- Reference spec sheet: `ALLDEEZMeals D-Plate.html`.

### Wordmark
`ALLDEEZMeals` set in **Plus Jakarta Sans 800**, `letter-spacing: -0.01em`. "ALLDEEZ" in `--c-text`, "Meals" in `--c-primary` (teal). Always one word (no space).

### Tagline
**"A week of dinners, planned in minutes."** (Do **not** put the "ALDI" trademark in brand/marketing copy. Descriptive in-app references like "optimized for your ALDI run" are lower-risk but use sparingly.)

### Typography
**Plus Jakarta Sans** for everything (single family), weights 400/500/600/700/800. Headings use `letter-spacing: -0.01em`.

| Role | Size / line-height / weight |
|---|---|
| Page title (h1) | 22 / 28 / 700 |
| Card hero (h2) | 19 / 25 / 600 (recipe title scales to 21–24) |
| Card/section title (h3) | 16 / 22 / 600 |
| Body | 15 / 22 / 400 |
| Body large | 16 / 24 / 400 (cook steps on tablet) |
| Body small | 13 / 18 / 400 |
| Label (UPPERCASE, tracked) | 12 / 16 / 700, `letter-spacing: 0.05em` |
| Caption | 11 / 14 / 600 |

---

## Design Tokens
All defined in `warm-market.css` (`:root`). Override `--font-serif` and `--font-sans` both to `'Plus Jakarta Sans'` (the final direction uses one family).

### Colors
| Token | Hex | Use |
|---|---|---|
| `--c-primary` | `#2B8C7E` | teal — primary actions, logo, accents |
| `--c-primary-hover` | `#236F64` | |
| `--c-primary-tint` | `#E4F0EC` | selected/info fills, current cook step |
| `--c-accent` | `#F2856B` | coral — cuisine tags, dish dot, rating stars |
| `--c-accent-hover` | `#E37152` | |
| `--c-bg` | `#FBF7F1` | app canvas (warm cream) |
| `--c-surface` | `#FFFFFF` | cards |
| `--c-surface-2` | `#F4F1E9` | sunken areas, nav bar, inactive pills |
| `--c-text` | `#1A3A34` | ink (deep teal-black) |
| `--c-text-muted` | `#7C8A80` | secondary text |
| `--c-border` | `#E6DDD0` | hairlines |
| `--c-on-primary` | `#FFFFFF` | text on teal |
| `--c-success-bg` | `#E6F1EC` | "Accepted" badge, price estimate bg |
| `--c-success-text` | `#136B58` | |
| `--c-pill-text` | `#5E281A` | text on coral pills |
| `--c-danger` / `--c-danger-bg` | `#A8453C` / `#F6E7E4` | thumbs-down, destructive |
| `--c-warning` / `--c-warning-bg` | `#8A6D3B` / `#F3EAD6` | "staple"/"estimated" tags |

### Spacing (4px base)
`--space-1:4 · -2:8 · -3:12 · -4:16 · -5:20 · -6:24 · -7:32 · -8:40`

### Radius
`--radius-sm:8 (inputs/chips) · -md:12 (buttons/inner) · -lg:16 (cards) · -pill:999`

### Elevation (tinted with ink, not pure black)
- `--elev-1: 0 1px 2px rgba(26 58 52 /.06), 0 1px 3px rgba(26 58 52 /.05)`
- `--elev-2: 0 4px 14px rgba(26 58 52 /.09), 0 2px 6px rgba(26 58 52 /.05)`
- `--elev-primary: 0 2px 8px rgba(43,140,126,.28)`

### Interaction
`--tap-min: 44px` (min touch target) · focus ring `0 0 0 3px rgba(43,140,126,.30)`

---

## Global: App Header + Navigation
(Component: `AppHeader` in `ALLDEEZMeals Today.html` and `ALLDEEZMeals Planning and Shopping.html`)

- **Top row** (white surface, bottom hairline): D-Plate icon tile (46px desktop / 40px mobile) · wordmark + tagline caption beneath · right side: user email + circular avatar (+ help/chat/logout icon buttons in the real app).
- **Nav bar:** a `--c-surface-2` rounded (`12px`) container, padding 6, `overflow-x: auto` on narrow screens. Tab buttons (`.navtab`): 13px / 600, muted; **active** = white background, `--c-primary` text, 700 weight, `box-shadow: 0 1px 3px rgba(26,58,52,.12)`.
- **Tab order:** `Today` (first) · **Planning group** · `Shopping List` · `Recipe Box` · `Receipt` · `History` · `Catalog`.
- **Planning group:** Setup and Meals are wrapped together in a bordered, teal-tinted (`rgba(43,140,126,0.06)`) rounded container with a tiny uppercase **"PLANNING"** label (9px / 800, tracked). The group border turns `--c-primary` when either Setup or Meals is active. Clicking Setup or Meals opens the Planning screen on that sub-tab.

> Renamed: **"List" → "Shopping List"**, **"This Week" → "Today"** (removed; merged into the cook view).

---

## Screen 1 — Today (cook mode)
(Component: `TodayCook` in `frames/today-components.jsx`. Tablet = `wide` prop true, two columns; mobile = single column.)

**Purpose:** Cook tonight's dinner on a phone/tablet on the counter, tracking progress; rate it when done.

**Day bar** (sticky-feel header, white surface, `--elev-1`):
- Left: small label — "Tonight" (today) / "Upcoming" (future) / "Earlier" (past), `--c-primary`; below it the date `h1` "Thu, Jun 4" (`white-space: nowrap`).
- Right: weather chip (`.wm-tag`) — emoji + "86°F".
- Row below: prev `‹` button · **7-day rail** · next `›` button.
  - **Day rail pill** (one per day, flex:1): weekday abbrev (caption, uppercase) + date number (serif-weight 600, 18px) + state glyph. **Active/today** = filled `--c-primary`, white text. **Past** = transparent, muted, small check, opacity .55. **Future** = `--c-surface-2` fill, shows the day's weather emoji. Today also shows a small coral dot indicator. Tapping a pill switches the day (and resets that day's progress in the mock).

**Recipe header:** cuisine tag (`.wm-tag--cuisine`, coral) · title (h2, 21px mobile / 24px tablet) · description (body-sm muted) · **meta row**: clock + total min, flame + "~720 kcal", effort tag (`●●○○○ Simple`), and a right-aligned **serving stepper** (− N +, min 1).

**Body** (tablet: two columns `0.85fr 1.25fr`; mobile: stacked):
- **Gather** (ingredients): label "Gather · {checked}/{total}". Each ingredient is a full-width tappable row: a 24px check box (`.wm-check`, fills teal w/ white check when on) + name (strikethrough + muted when checked) + qty (right, muted). "staple" tag where relevant.
- **Cook** (steps): label "Cook · {done}/{total} steps" + a thin progress bar (fills `--c-primary`). One-time hint "Tap a step to mark your place as you cook" (shows only when 0 done). Each step is a tappable card:
  - **Current step** (first not-done): `--c-primary-tint` bg, `--c-primary` border, `--elev-1`, number badge filled teal/white.
  - **Done:** transparent bg, badge filled teal w/ check, text muted + strikethrough.
  - **Upcoming:** white bg, hairline border, muted badge.
  - Step text is body-large on tablet, body on mobile.

**Footer (sticky bottom, white surface, top hairline):**
- Before cooking: **"Mark as made"** button (full width; becomes `--c-primary` solid once all steps done, else secondary) + optional "Next day →" ghost button.
- After tapping Mark as made → **rating panel**: green check chip + "Logged for {day}" + "How was it? Rate it so we learn your taste." + **5-star tap rating** (coral when filled). Responsive copy: ≥4★ "More like this →", 3★ "Noted — it was fine", ≤2★ "We'll show it less ↓". Then a primary **"On to {next day} →"** button. (Rating feeds the taste-learning model.)

---

## Screen 2 — Planning (Setup + Meals)
(Components: `PlanningView`, `SetupPane`, `SetupDayRow`, `MealsPane`, `MealCard` in `frames/app-screens.jsx`.)

**Purpose:** One screen, two steps. Header: label "Planning", h1 "Plan your week", sub "Set it up, then review what we generated — two steps, one place."

**Sub-toggle** (segmented, `--c-surface-2` container): **1 Setup** / **2 Meals**. Active segment = white pill + shadow + teal, with a numbered badge (filled teal when active).

### Setup pane
- **Card 1 — basics:** fields (each `.wm-field-label` + control) for **Start date** (date picker), **Days** (select), **People** (number). Then a location row: pin icon + "Bloomfield, IA" + "change location" link. *(In the prototype these are display-only divs styled like inputs — implement as real `<input type="date">`, `<select>`, `<input type="number">`, and a location picker.)*
- **Card 2 — "Your week":** helper "Forecast auto-fills. **Temp = Auto** adapts the dish to the weather." Then one **day row** per planned day (`SetupDayRow`):
  - Header: weekday + date (nowrap) · right: weather (emoji + hi/lo + condition) · **"Skip day"** toggle (a `.wm-check` box + label). When skipped, the row dims (opacity .7) and the controls collapse to italic muted text "No dinner this day — we'll leave {day} off the plan and the shopping list."
  - Controls (when not skipped): **ppl** (small number input) · **cuisine** select · **temp** select (Auto/Hot/Cold/Either — "dish warmth," adapts to weather) · **effort** select.
  - **Per-day note field** (full-width text input): placeholder "Add a note for this day (optional) — e.g. 'use up the leftover chicken', 'keep it quick'." This is freeform guidance fed to the generator.
- **"Generate this week →"** primary button (full width).

### Meals pane
- Top row: "{n} of {n} dinners accepted" + "Regenerate all ↻" link.
- One **MealCard** per day: caption "THU, JUN 4 · 1 PPL · ⛅ 86F" + **Accepted** badge (success colors, check). Title (h3). Cuisine tag + short description. Meta "Prep X · Cook Y · Serves Z". Action row: **Swap** (secondary sm, with swap icon) · spacer · 👍 / 👎 (toggle, border turns teal/danger) · ★ save. *(Emoji thumbs are placeholders — replace with real icon set in the codebase.)*

---

## Screen 3 — Shopping List
(Components: `ShoppingList`, `ShoppingRow` in `frames/app-screens.jsx`.)

**Purpose:** One consolidated, de-duplicated, reuse-aware grocery list for the week.

- Header: h1 "Shopping list" + sub "{n} items · 7/7 dinners + staples".
- Toolbar: **Copy list** (primary, copy icon) + **Instacart (AI)** (secondary, cart icon).
- **"Always have"** sunken card (`.wm-sunken`): star + "Always have" (nowrap) + right caption "auto-excluded weekly"; below, teal pill chips of pantry staples (Salt, Pepper, Olive oil, …). These are excluded from the weekly buy.
- **Category cards** (Produce, Meat & Seafood, Pantry, Dairy & Bakery): h3 category title (teal, hairline underline) then **rows** (`ShoppingRow`):
  - 24px checkbox (`.wm-check`) — toggles; checked row gets strikethrough + muted name.
  - Name (600) + " · qty" (muted).
  - **"have it"** pill toggle on the right — when on, fills teal/white (item you already have at home).
- **Price estimate footer** (success-bg block): "Est. $58.40" (success-text, bold) + "— recent prices, not a quote." *(Real app: ALDI price data; show per-item where known.)*

> **Ingredient-reuse engine (important):** the generator should de-duplicate ingredients across the week and note reuse (e.g. "second avocado from the 2-count bag used here"). The original product surfaces these as per-meal notes; keep them **concise/chip-style**, not paragraphs.

---

## Interactions & Behavior summary
- **Today:** tap ingredient = check/uncheck; tap step = complete/uncomplete (current step auto-advances, progress bar updates); serving stepper ± ; day rail / prev-next switches day; Mark as made → rating → next day. Each day starts with fresh progress.
- **Planning:** sub-toggle switches Setup/Meals; Skip-day collapses a day; note input is freeform; thumbs toggle on meal cards.
- **Shopping:** checkbox strike-through; "have it" toggle.
- **Weather-aware:** each day shows the forecast; "Temp = Auto" lets the generator pick warm vs. cold dishes to suit the weather.
- All transitions are short (.12–.2s) on background/border/box-shadow/width.

## State Management (per screen)
- **TodayCook:** `activeDay`, `doneSteps:Set`, `gatheredIngredients:Set`, `servings`, `made:bool`, `rating:int`. Reset day-scoped state on day change. Real app: persist progress + rating to backend (rating feeds taste model).
- **PlanningView:** `subTab`; per `SetupDayRow`: `skipped:bool`, `note:string`, plus ppl/cuisine/temp/effort. Real app: persist the plan config; "Generate" calls the meal-generation API (inputs: people, days, location/forecast, per-day cuisine/temp/effort/notes, skip flags, taste history).
- **ShoppingList:** `checked:Set`, `haveIt:Set`. Real app: list derived from accepted meals minus "Always have" staples and "have it" items; price estimate from ALDI data.

## Assets
- **Icons:** the prototype uses inline Lucide-style line icons (`TodayIcon`/`AppMiniIcon`: clock, users, flame, check, star, copy, cart, swap, pin) and emoji for weather + thumbs. Replace with the codebase's icon library; keep stroke ~1.8.
- **Logo:** the D-Plate is generated from type + a CSS circle (no asset file needed) — see spec above and `ALLDEEZMeals D-Plate.html`. Export SVG/PNG app-icon variants from that spec.
- **Recipe photos:** optional; designs degrade gracefully with a striped placeholder when absent.
- **Fonts:** Plus Jakarta Sans (Google Fonts).

## Files in this bundle
- `ALLDEEZMeals Today.html` — Today/cook-mode screen, in the app shell (tablet + mobile).
- `ALLDEEZMeals Planning and Shopping.html` — Planning (Setup+Meals) and Shopping List screens.
- `ALLDEEZMeals D-Plate.html` — logo/app-icon spec (treatments + favicon sizes).
- `frames/today-components.jsx` — `TodayCook`, `TodayIcon`, `TodayStars`.
- `frames/app-screens.jsx` — `PlanningView`, `SetupPane`, `SetupDayRow`, `MealsPane`, `MealCard`, `ShoppingList`.
- `assets/warm-market.css` — design tokens + `wm-*` utility classes (override both font vars to Plus Jakarta Sans).

## Not yet designed (out of scope here)
Recipe Box, Receipt, **History** (currently errors in the live app — needs its own design pass), and Catalog. These tabs exist in the nav but were not part of this refresh.
