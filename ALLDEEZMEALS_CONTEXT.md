# ALLDEEZMEALS_CONTEXT

## Overview
Canonical URL: https://alldeezmeals.com
ALLDEEZMeals is a personal/family ALDI meal-planning web app. Weather-aware dinner
generation, ingredient reuse across the week, standing breakfast/lunch staples, one
consolidated ALDI shopping list, and lightweight preference learning (thumbs + rotation).
Not a commercial product; built for household use. May later add shared (multi-user) access.

## Stack
- Vite + React 18 + TypeScript + Tailwind
- Weather: Open-Meteo (free, keyless, direct browser fetch)
- Meal generation: Anthropic API via serverless proxy `/api/generate`
- Auth: Supabase (magic-link / email OTP, invite-only)
- Storage: localStorage (per device) — Supabase is the upgrade path for shared access
- Hosting: Vercel

## Repos / IDs
- GitHub: `Terenc-LLC/alldeezmeals`
- Linear: team "Terenc" (TER). Project + issues seeded for the productionization work.
- Vercel: project imported from the GitHub repo; env var `ANTHROPIC_API_KEY` set server-side.

## Workflow
Same as AXIS / Yergers: Opus architects and writes Linear issue descriptions; Code
implements; Chris reviews and merges. Code updates this context doc at the end of each
session (status, decisions, next steps).

## Design principles
- API key never in the browser — always behind `/api/generate`.
- Prefer free/keyless data sources where possible (Open-Meteo for weather).
- Default to the cheapest adequate model; expose model swap in the proxy.
- Generate dinners sequentially so each can reuse earlier ingredients and avoid double-buying.
- Always include the standing staples (breakfast/lunch) in the grocery list.
- Force cuisine variety across the week unless a cuisine is pinned per day.

## Status (TER-173 — May 2026)
- Per-user Supabase schema + RLS (TER-173): created five tables with row-level security.
  `user_state` (one row per user, full CRUD, `user_id = auth.uid()`), `orders` (per-user
  archive shell for TER-181), `catalog` (shared ALDI product catalog — SELECT for any
  authenticated user, no client INSERT/UPDATE/DELETE; service role only for writes),
  `item_usage` (per-user purchase history shell for TER-190), `allowed_emails` (invite
  allowlist from TER-187, IF NOT EXISTS). Migration SQL in
  `supabase/migrations/20260525_001_per_user_schema.sql`; RLS test queries in
  `supabase/rls_test.sql`.
- App now writes to and reads from `user_state` via the Supabase client (anon key + user
  JWT, no service role in client bundle). Load order: localStorage (instant) then Supabase
  (overrides on first sign-in for that user). Save order: localStorage (immediate) + Supabase
  upsert debounced 2 s (offline-safe fire-and-forget). `checkedItems` added to persisted
  state (was missing from localStorage save before this issue).
- `catalog` and `item_usage` are schema+RLS only — not populated or wired into the UI.
  Population arrives with TER-186 (receipt ingestion) and TER-190 (affinity).
- No service-role key in the client bundle; `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
  are the only Supabase vars needed on the client (already set in Vercel from TER-187).
  Service role key is needed server-side only for catalog ingestion (TER-186).
- `tsc --noEmit && vite build` pass.

## Status (TER-188 — May 2026)
- `/api/generate` server-side auth (TER-188): Supabase JWT validation added, closing the
  open-proxy gap from TER-187. After the method and API-key guards, the handler reads the
  `Authorization: Bearer <token>` header, rejects missing/malformed tokens with 401, then
  calls `supabase.auth.getUser(token)` using the anon key (`VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` — no new env vars needed). Invalid/expired tokens → 401; valid
  session → proceeds to the Anthropic call. No service-role key used or introduced.
  TER-187 stub comment replaced. `tsc --noEmit && vite build` pass.

## Status (TER-187 — May 2026)
- Supabase auth (TER-187): passphrase gate replaced by Supabase magic-link / email OTP.
  `@supabase/supabase-js` added; client initialised from `VITE_SUPABASE_URL` +
  `VITE_SUPABASE_ANON_KEY` (anon/publishable key only — no service_role in client).
  Sign-in screen: email input → "Send magic link" → "Check your email" confirmation.
  Session persists across reloads via Supabase's default localStorage persistence.
  "Signed in as <email>" shown in the header next to the sign-out button.
  App boots signed-out; unauthenticated users see only the sign-in screen.
  Invite-only enforced at the Supabase dashboard (public sign-ups off); `shouldCreateUser:
  false` added as belt-and-suspenders.
  `/api/generate` x-app-key check removed (stub comment left for TER-188 JWT validation).
  Supabase access token forwarded as `Authorization: Bearer <token>` on every API call
  so TER-188 can validate it server-side without a client change.
  `APP_PASSPHRASE` env var no longer needed (removed from `.env.example`).
  Two new Vercel env vars required: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Status (TER-181 — May 2026)
- "Mark as ordered" archive action (TER-181, final): "Mark ordered & start next week" button
  added to List tab toolbar (next to Copy buttons). Disabled when no meals are accepted.
  On confirm: builds a snapshot of `acceptedMealsForPrint` (day/date/mealData incl. recipes,
  steps, ingredients with purchaseSize/purchaseQty), `groceryList`, `listText`, `startDate`,
  `numDays`, and `location`, then inserts `{ user_id, plan: snapshot }` into the per-user
  `orders` table (RLS owner `WITH CHECK (user_id = auth.uid())`). `resetPlan()` (shared
  helper extracted from `handleStartOver`) is called only after a confirmed successful insert.
  On insert failure (offline, etc.): plan is NOT cleared; error shown in toolbar area.
  `handleStartOver` refactored to call `resetPlan()` — both actions stay in sync.
  RLS: the row lands under the signed-in user via the anon key + user JWT (no service role).
  `tsc --noEmit && vite build` pass.

## Status (TER-184/185 — May 2026)
- List hygiene (TER-184): `purchaseQty` floored at 1 (no zero-qty lines). Ingredient names
  normalized (lowercase, strip trailing parentheticals) before aggregation so near-dupes like
  "sour cream" + "sour cream (full fat)" merge into one line. Zero-qty items filtered from
  the rendered list and copy/Instacart text. Normalization is conservative — distinct items
  (salted vs unsalted butter, corn vs flour tortillas) are not merged.
- Generation tuning (TER-185): `buildPrompt` now explicitly biases toward ALDI-stocked
  mainstream items and instructs the model to omit common pantry seasonings (salt, pepper,
  dried spices) and basic cooking oils from the purchase list by default (they still appear
  in cooking steps; a defining/central spice may still be purchased at model's judgment).

## Status (TER-183 — May 2026)
- Scaffold builds clean (`tsc --noEmit && vite build` OK).
- Frontend ported from the Claude artifact prototype.
- Passphrase gate (TER-177 revised): user-entered passphrase stored in `localStorage` key
  `alldeez-passphrase`. Gate screen shown on first visit or after sign-out/wrong key. Sent
  as `x-app-key` header on every `/api/generate` call. 401 → clears stored value, re-shows
  gate with error message. No secret in the JS bundle; `VITE_APP_PASSPHRASE` removed.
  Server now fail-closes: returns 500 if `APP_PASSPHRASE` is not set.
- Full recipes (TER-178): generation returns `prepMinutes`, `cookMinutes`, `steps[]`.
  max_tokens = 2000. Displayed on meal cards. "Print recipes" prints all accepted meals.
- Instacart copy (TER-180 stub, superseded): earlier scaffold; replaced by the full TER-180 implementation below.
- Purchase-quantity grocery list (TER-183): ingredient JSON shape changed — each ingredient
  now carries `recipeAmount {qty, unit}` (cooking amount) and `purchaseSize` / `purchaseQty`
  (whole ALDI package). Grocery list aggregates on purchaseSize, summing purchaseQty (whole
  packages), so the list reads "garlic — 1 head" not "garlic — 2 cloves". Meal cards and
  print view still show recipeAmount (cooking amounts). Chips show a subtle "buy: 1 head"
  note where purchaseSize differs from recipeAmount. AVOID-DOUBLE-BUYING rule updated to
  operate on purchases, not recipe quantities. Old saved meals (pre-TER-183 shape) fall back
  to old qty/unit behavior — no crash on load.
- Two env vars required: `ANTHROPIC_API_KEY` (server), `APP_PASSPHRASE` (server).
  `VITE_APP_PASSPHRASE` must be DELETED from Vercel if previously set.

## Status (TER-189 — May 2026)
- localStorage→Supabase one-time migration (TER-189): effect 2 (sign-in fetch) now migrates
  pre-existing localStorage data to the signed-in user's `user_state` row the first time they
  sign in, without requiring an edit. Trigger: `maybeSingle()` returns `null` (no row exists)
  AND localStorage parses to a non-null object. If any row exists (even empty, e.g. after a
  Start-over), migration is skipped — cloud is authoritative. Idempotent: after migration a row
  exists, so re-sign-ins/reloads are no-ops. `hydrated.current` is set inside the nested upsert
  callback, preserving the TER-173 gate (effect 3 can't write until the migration completes).
  `catalog` is NOT migrated (server-write-only, no client localStorage). Cross-device: first
  device to sign in migrates its local data; subsequent devices load the cloud row.
  `tsc --noEmit && vite build` pass.

## Status (TER-193 — May 2026)
- FDC spike complete. Full findings in `docs/spikes/TER-193-fdc-investigation.md`.
- **Generic coverage**: 6/6 (100%) — Foundation/SR Legacy covers all common staples.
- **ALDI private-label via FDC brand-name search**: ~0/4 — FDC stores the co-packer as
  `brandOwner`, not the retail brand (Carlini → "Conagra Brands"). Text search is unreliable
  for private-label items; UPC → FDC GTIN lookup is the correct path.
- **Open Food Facts**: 57 Simply Nature results with real nutrition data; viable as
  supplementary source for ALDI private-label by brand name or UPC.
- **Parsing**: FDC `foodPortions` provides household-measure → gram conversions
  (e.g. "1 clove" = 3g). Fallback table for pinch/dash; skip "to taste"/"as needed".
- **Per-serving math**: validated (±5% of reference). Formula: `(grams/100) × kcal_per_100g`.
- **Matching heuristic**: Foundation > SR Legacy > Branded; prefer "raw"; penalize "cooked".
- **Cache design**: Supabase `nutrition_cache` table; key = normalized name or `upc:{gtin}`;
  TTL 7 days; SELECT for auth'd users, INSERT/UPDATE server-side only.
- **Bulk seed (TER-198)**: Go — OFF bulk CSV for availability (0 API calls), FDC GTIN for
  nutrition enrichment (2–4 hr at 1,000 req/hr).
- **Action required**: register free FDC API key at api.data.gov/signup; add as `FDC_API_KEY`
  server-side env var. DEMO_KEY (40 req/day) is insufficient for development.

## Status (TER-186 — May 2026)
- Order/receipt ingestion + self-building ALDI catalog.
- **Schema migration** (`supabase/migrations/20260525_002_catalog_full_schema.sql`): drops the dormant
  TER-173 catalog shell and recreates it with the full target shape: `normalized_name` (non-unique
  indexed column for future generic→product lookup), `product_name`, `brand`, `category`,
  `package_size`, `upc`, `last_price_cents`, `last_seen_at`, nutrition columns (blank, for TER-195),
  `source`, `created_at`, `updated_at`. RLS re-applied. FK from item_usage dropped and re-added.
  **TER-195 and TER-198 must populate existing columns, not add new migrations.**
- **`/api/ingest-order.ts`**: validates Bearer JWT; derives `user_id`; uses `SUPABASE_SERVICE_ROLE_KEY`
  to upsert shared `catalog`; upserts per-user `item_usage` with select+increment. Skips refunds and
  unchecked rows.
- **`SUPABASE_SERVICE_ROLE_KEY`** must be the **LEGACY service_role JWT** (starts with `eyJ…`), found
  under Supabase → API Keys → "Legacy anon, service_role API keys" tab. The new `sb_secret_…` key
  does NOT bypass RLS via supabase-js in this project — service-role writes (catalog ingestion, future
  seed endpoints) are rejected with it. Applies to every service-role endpoint.
- **Receipt tab**: paste → parse (Haiku) → review → `/api/ingest-order`.
- Known v1 limitation: re-submitting the same receipt re-increments `item_usage.purchase_count`.
- `tsc --noEmit && vite build` pass.

## Status (TER-202 — May 2026)
- Fixed two bugs in the TER-186 ingestion flow found after the first real receipt ingest.
- **Bug 1 — duplicate catalog rows for the same product**: the dedup key changed from `normalized_name`
  (LLM generic name, noisy and many-to-one) to `normalized_product` (= lowercased/trimmed/
  whitespace-collapsed `product_name`). Migration `20260525_003_catalog_product_key.sql`:
  adds `normalized_product text NOT NULL`, drops `UNIQUE (normalized_name)`, adds
  `UNIQUE (normalized_product)`, adds non-unique index on `normalized_name` (for future
  generic→product lookup in v2). `normalized_name` is kept on the row as the latest generic name
  seen for that product (lossy v1; a proper alias table is deferred to v2).
  Batch-level dedup: within a single submit, items are deduplicated by `normalized_product` before
  any DB writes (last-wins on size/price), so two-line cases like "hard salami" + "lunch mate hard
  salami" collapse to one row.
  After applying the migration, truncate `public.item_usage` and `public.catalog` (first-run test
  data only) via SQL editor, then re-ingest.
- **Bug 2 — purchase date = upload date, not receipt date**: parse prompt now returns
  `{ "orderDate": "YYYY-MM-DD", "items": [...] }` instead of a bare array. Review UI shows a single
  editable order date field (defaulted to the parsed value or today). Endpoint accepts `orderDate`;
  uses it for `catalog.last_seen_at` and `item_usage.last_purchased_at`; falls back to `now()` if
  missing or unparseable. `created_at`/`updated_at` remain ingestion-time row-audit timestamps.
- `item_usage.item_name` now stores `normalized_product` (consistent with the catalog dedup key) so
  re-ingests of the same product correctly increment the existing row.
- `tsc --noEmit && vite build` pass.

## Status (TER-194 — May 2026)
- `/api/nutrition` USDA FDC proxy + shared cache (TER-194).
- **`nutrition_cache` table**: new migration `20260525_004_nutrition_cache.sql`. Shape:
  `{ id, cache_key text UNIQUE, result jsonb, fdc_id text, gtin text, source text, retrieved_at }`.
  RLS: SELECT + INSERT + UPDATE for any authenticated user. Endpoint uses the caller's access
  token for cache writes (no service-role key here); `auth.uid()` satisfies the write policy.
- **`/api/nutrition.ts`**: POST, authed only (Bearer JWT validation matching `/api/generate`).
  Two modes:
  - `{ mode: "name", ingredient: "garlic" }` — FDC Foundation + SR Legacy search, scoring
    heuristic from TER-193 (Foundation > SR Legacy; prefer "raw", penalise cooked), detail
    fetch for `foodPortions` + macros.
  - `{ mode: "gtin", gtin: "04099100042736" }` — FDC Branded GTIN lookup, Open Food Facts
    fallback (keyless) if FDC misses.
  Returns `{ hit: true, kcal_per_100g, serving_basis?, foodPortions?, macros?, fdcId|gtin,
  dataType, source, attribution }` on a match, `{ hit: false, miss_reason }` on a miss (so
  callers fall through to catalog/estimate tiers without throwing).
  "to taste" / "as needed" ingredients short-circuit to `{ hit: false, miss_reason: "skip" }`.
  Cache TTL 30 days; stale rows re-fetched and updated. Cache writes non-fatal.
- **`FDC_API_KEY`** confirmed present in local `.env` (real key, not DEMO_KEY). Added to
  `.env.example` with instructions. Never in the client bundle.
- Attribution string: `"Nutrition data: USDA FoodData Central"` (exported as `USDA_ATTRIBUTION`
  from the endpoint; callers reference it for display).
- `tsc --noEmit && vite build` pass.

## Status (TER-182 — May 2026)
- Persistent "always have" staples tier added (client-side, no DB/endpoint change).
- **State**: `alwaysHave: string[]` added to all three persistence points (localStorage load,
  Supabase load in sign-in effect, and save payload + dependency array). Stores normalized item
  names via `normalizeIngName` so matching is case-insensitive and parenthetical-stripped.
- **Grocery list**: always-have items excluded in `groceryList` useMemo alongside existing pantry
  exclusion (same filter block, not a parallel path). `alwaysHave` added to dependency array.
- **ListView UI**:
  - Each grocery item gains a ★ star button (new `starBtn` style). Clicking normalizes the item
    name and toggles it in `alwaysHave`. When starred: item disappears from the list (excluded)
    and appears in the Always Have panel.
  - "Have it" button styling updated: when an item is always-have OR pantry, button shows filled
    (dark green background, white text) instead of just a border color change.
  - "★ Always have" management panel at the top of the List tab shows all always-have items as
    dark-green removable chips (X to remove), plus an add-by-name input (Enter or Add button).
- No schema change, no migration, no endpoint change. `tsc --noEmit && vite build` pass.

## Status (TER-180 — May 2026)
- **Ordering path confirmed**: Instacart Developer Platform (IDP) is closed (TER-179 ruled
  out). The ordering path is user-driven copy/paste: user taps "Copy for Instacart (AI)",
  pastes into Claude or ChatGPT (with Instacart enabled), the assistant builds the ALDI
  Instacart cart, user finalizes on Instacart. No third-party app can programmatically drive
  a consumer assistant's Instacart connector — this is intentional by design.
- **`src/lib/instacart-handoff.ts`**: pure `buildInstacartHandoff(groceryList, catalog)` →
  `{ preamble, lines[], lineItems[] }`. Implements Layer 1 (internal API-aligned line-item
  model: name, display_text, quantity, unit, upc[]) and Layer 2 (text rendering). Unit
  normalization follows Layer 3 of the Instacart Handoff Format Spec (TER-180 Linear doc):
  countable produce → "each"; leafy heads → "head"; eggs → "large"/dozen; compound container
  ("14.5 oz can") → "oz can"; unsupported container ("box") → "package"; bare weight → unit+qty;
  fallback → "package". Size-based rules fire before name-based rules so "Diced tomatoes —
  14.5 oz can" resolves to "oz can" not "each".
- **Catalog join**: `normalized_name → upc` lookup; UPCs validated 12/14 digits; de-duped
  across line items. Catalog loaded lazily in ListView on mount (normalized_name + upc only).
- **"Copy for Instacart (AI)" button** added to List tab, replacing the TER-183 stub. Copies
  preamble + matcher-aligned item lines. "Copy list" retained for plain/print use.
- **Unit tests** (`src/lib/instacart-handoff.test.ts`, Vitest): 23 tests cover all 6 required
  normalization cases plus catalog join, UPC validation, zero-qty exclusion, and UPC de-dupe.
  `npm test` to run. Vitest configured in `vite.config.ts`.
- Spec: Linear doc "Instacart Handoff Format Spec (TER-180)" is the source of truth for
  the line-item field model, supported units, and normalization rules.
- `tsc --noEmit && vite build` pass.

## Status (TER-252 — May 2026)
- Design refresh PR4 — grocery list restyle (`ListView`).
- **`ListView` return block** fully replaced to match Warm Market spec. No new global state.
- **Header**: `h1` "Grocery list" (`s.typeH1` / Fraunces) + body-sm muted summary line.
- **Toolbar**: `.btn-primary` "Copy list" (Copy icon) + `.btn-secondary` "Instacart (AI)"
  (ShoppingCart icon — newly imported from lucide-react). Both `flex:1 1 auto` on mobile
  (wrap), shrink to content on desktop via `isMobile` toggle. Transient "Copied!" state
  preserved on both.
- **Always Have panel**: sunken block (`--c-surface-2`, `radius-md`). Lucide `Star` filled
  `--c-warning` in header. Chips use `s.lvAhChip` (primary bg, radius-pill). Existing add-
  item input kept.
- **Category cards** (`s.lvCatCard`): `--c-surface`, `radius-lg`, `--elev-1`, 16px padding.
  `s.lvCatTitle`: Fraunces 15, primary, bottom border.
- **Grocery rows** (`s.lvRow`): min-height 44px, gap 12px. Checkbox (`s.lvCheck`): 24×24,
  `radius-sm`, 2px border, fills primary + Check strokeWidth 2.6 when checked. Name/qty label
  uses `s.typeBody`/`s.typeBodySm`; line-through + muted when checked. "have it" pill
  (`s.lvHaveIt`): outlined → fills primary when active. Star (`s.lvStar`): lucide Star with
  fill toggle. Staple (`s.lvStaple`): warning-bg radius-pill label.
- **Price estimate footer** (`s.lvFooter`): `--c-success-bg`, `radius-md`, bold success-text
  total + "not a quote" note.
- **Archive button**: `.btn-ghost .btn--sm .btn--block` at bottom of list.
- **Desktop**: `maxWidth: 680, margin: "0 auto"` inner div; single centered column.
- **`s` object**: added `lvSunken`, `lvAhChip`, `lvCatCard`, `lvCatTitle`, `lvRow`, `lvCheck`,
  `lvHaveIt`, `lvStar`, `lvStaple`, `lvFooter`.
- PR #40 open: https://github.com/Terenc-LLC/alldeezmeals/pull/40
  Commit: `e99c4a4`. Awaiting Chris review/merge.
- `tsc --noEmit && vite build` pass (472.38 kB JS / 9.28 kB CSS, 0 TS errors).

## Status (TER-251 — May 2026)
- Design refresh PR3 — standalone meal/recipe card.
- **New `RecipeCard` component** in `src/App.tsx`: standalone presentational card (no
  Accept/Reject/thumbs). Anatomy per spec: striped no-photo image slot (190 mobile / 240
  desktop), cuisine pill, h2 meal name + body-sm description, meta row (time/serves/kcal with
  Lucide Clock/Users/Flame at 15px primary color), kcal-source + effort-pip badges, divider,
  ingredients list (name vs right-aligned qty, dashed row separators, staple pills), numbered
  instructions with 26px step markers (`--c-primary-tint` bg / `--c-primary-hover` text),
  footer with `btn-secondary` "Save to rotation" + `btn-ghost` Print.
- **Desktop layout**: ingredients + instructions in a 2-col grid `1fr 1.2fr`; card centered
  at `max-width:680`. Mobile: single column.
- **`s` object**: added `rcCard`, `rcImgSlot`, `rcImgHint`, `rcCuisinePill`, `rcMetaItem`,
  `rcKcalBadge`, `rcKcalBadgeEst`, `rcEffortBadge`, `rcDivider`, `rcIngRow`, `rcStaplePill`,
  `rcStepRow`, `rcStepMarker` entries consuming PR1 tokens.
- **`RotationView`** updated: each saved recipe is now a button that opens the `RecipeCard`
  detail view inline (replaces the rotation list in the tab). A "← Back" ghost button returns
  to the list. The planner's action-bearing card (Accept/Reject/thumbs, inline in `PlanView`)
  is untouched.
- **Lucide imports** added: `Clock`, `Users`, `Flame`, `Printer`.
- No new `:root` tokens needed — all tokens from PR1 (`--c-primary-tint`, etc.) consumed.

## Status (TER-250 — May 2026)
- Design refresh PR2 — button system.
- **`src/index.css`**: added `.btn-primary`, `.btn-secondary`, `.btn-ghost` CSS classes with full
  spec: 44px min-height, `var(--radius-md)`, PR1 tokens for colors/shadow, hover/focus-visible/
  active (`translateY(1px)`)/disabled states. `.btn--sm` modifier (36px) and `.btn--block`
  modifier. All consuming PR1 tokens; no existing `--c-*` colors changed.
- **`src/App.tsx` `s` object**: `primaryBtn` and `ghostBtn` updated to PR1 token values.
  The `btnPrimary`, `btnSecondary`, `btnGhost`, `btnSm`, `btnBlock` s-object entries were
  **NOT kept** — they were added in the initial PR2 commit and then removed by the cleanup
  commit (`9531cf2`). Buttons use `.btn-primary` / `.btn-secondary` / `.btn-ghost` CSS classes
  (+ `.btn--sm` / `.btn--block` modifiers) as the sole source of truth. Do NOT create inline
  button style objects for new buttons; use `className="btn-..."` instead.
- Applied CSS classes to in-scope screen buttons: SetupView generate (btn-primary btn--block),
  start over (btn-ghost btn--block btn--sm); PlanView print (btn-secondary btn--sm); ListView
  Copy list (btn-primary), Instacart AI (btn-secondary — upgraded from ghost per spec), Mark
  ordered (btn-ghost). Planner action buttons untouched (out of Phase 1 scope).
- PR #38 open: https://github.com/Terenc-LLC/alldeezmeals/pull/38
  Commit: `f660dcf72c04b6c16dc247ae113a4322aa3ddc99`. Awaiting Chris review/merge.
- `tsc --noEmit && vite build` pass (462.69 kB JS / 9.05 kB CSS, 0 TS errors).
- **PR3–PR5 are the next steps** in the design refresh series.

## Status (TER-249 — May 2026)
- Design refresh PR1 — foundation tokens.
- **`src/index.css` `:root`**: added all Phase 1 design-system tokens. Existing `--c-*`
  colors are unchanged (source of truth). New additions:
  - `--c-primary-tint: #E4F0EC`, `--c-shadow: 26 58 52` (RGB for tinted elevation)
  - `--font-serif`, `--font-sans` (family vars, same values as the JS consts, now tokenised)
  - 9 type-scale steps: `--t-display-*` → `--t-caption-*` (size / lh / weight each)
  - `--space-1` … `--space-8` (4px base: 4/8/12/16/20/24/32/40 px)
  - `--radius-sm/md/lg/pill` (8/12/16/999 px)
  - `--elev-0/1/2/primary` (shadows tinted with `--c-shadow`, not pure black)
  - `--tap-min: 44px`, `--focus-ring`
- **`src/App.tsx` `s` object**: `shell` updated to consume `var(--font-sans)` and
  `var(--space-5)` (no visual change — same resolved values). Nine type-step helpers
  (`typeDisplay` … `typeCaption`) added for PR2–PR5 to spread into component styles.
- PR #37 open: https://github.com/Terenc-LLC/alldeezmeals/pull/37
  Targets `main`; should NOT be merged until PR2–PR5 land and are reviewed together.
- `tsc --noEmit && vite build` pass (462 kB JS / 7.4 kB CSS, 0 TS errors).
- **PR2–PR5 are the next steps** in the design refresh series.

## Status (TER-282 — June 2026)
- Bug fix: print-only recipe pages were rendering on-screen before print was requested.
- **Root cause**: the injected `<style>` block in `src/App.tsx` set `.print-only{display:block}`
  unconditionally (a side effect of TER-253 making the section always-rendered). The section is
  conditionally *mounted* only when `acceptedMealsForPrint.length > 0`, so it appeared as soon
  as meals were accepted.
- **Fix** (2-line change in the `fontImport` style block, `src/App.tsx`):
  - Screen default: `.print-only{display:block}` → `.print-only{display:none}` (hidden on screen).
  - Added `.print-only{display:block}` inside the existing `@media print{…}` block, so the print
    path still renders the recipes. All TER-243 pagination rules (`.recipe-page` break-after,
    `.print-sheet` resets, `html,body,#root` overflow resets) are preserved untouched.
- No other files changed. `tsc --noEmit && vite build` pass (474.63 kB JS / 9.30 kB CSS).

## Status (TER-253 — May 2026)
- Design refresh PR5 — printable recipe restyle (final PR in Phase 1 series).
- **`.print-only` section** was made `display:block` (on-screen preview when accepted meals
  exist); this introduced the TER-282 bug, fixed separately above. Conditional render: section
  only mounts when `acceptedMealsForPrint.length > 0`.
- **Each `.recipe-page`** contains a `.print-sheet` paper div. On desktop: floats on `#d9d4ca`
  mat (`--c-print-mat` token added to `src/index.css`) with `0 8px 30px rgba(26,58,52,.18)`
  elevation. On mobile: paper on `--c-bg` with `1px --c-border` border.
- **Paper layout** per spec:
  - Masthead: 2px `#1A3A34` bottom rule; "ALLDEEZMeals" (label, `--c-primary`) left; "Weekday
    · Cuisine" (caption, muted) right.
  - h1 title (Fraunces 26px, letter-spacing −0.01em).
  - Meta strip: Prep / Cook / Serves / Per serving / Effort; bottom `1px` rule.
  - Body: Ingredients `ul` + Instructions `ol`; desktop 2-col `1fr 1.4fr`; mobile stacked.
  - Footer: print date left; kcal source right.
- **`@media print`**: mat/padding removed from `.print-only`; `.print-sheet` loses
  shadow/border/radius; page-break after each `.recipe-page`.
- **Dead code cleanup**: removed orphaned `s.howto`, `s.howtoTitle`, `s.howtoList` (how-to
  block was removed in PR4; no remaining JSX references).
- PR #41 open: https://github.com/Terenc-LLC/alldeezmeals/pull/41
  Commit: `fb72533`. Awaiting Chris review/merge.
- `tsc --noEmit && vite build` pass (474.45 kB JS / 9.30 kB CSS, 0 TS errors).

## Status (TER-254 — May 2026)
- Bug fix: mobile horizontal scroll on iPhone 15 Pro (390px viewport).
- **Root causes identified and fixed** (4 targeted changes in `src/App.tsx`):
  1. `s.mealCard` lacked `overflow: hidden` — unlike `s.rcCard` (RecipeCard), PlanView
     meal cards had no containment, so any wide AI-generated content (long ingredient names,
     long purchase strings) could propagate scroll to the body. Added `overflow: "hidden"`.
  2. `s.tag` had no word-break constraint — long AI-generated ingredient + purchase-size
     strings in PlanView ("Boneless skinless chicken breast — 2 cups · buy: 1 × 2 lb bag")
     can exceed the card content width (332px) when the browser doesn't shrink the flex item
     below its max-content. Added `overflowWrap: "break-word"` + `maxWidth: "100%"`.
  3. Print-sheet masthead (`justifyContent: space-between`, no `flexWrap`) — at viewport
     widths 481–640 px (non-mobile, but narrower than the `maxWidth: 640` sheet cap), the
     sheet's content area drops to ~289 px, where long weekday+cuisine combos can overflow
     the masthead row. Added `flexWrap: "wrap"` + `gap: var(--space-2)` to the masthead div.
  4. `.print-only` outer wrapper (PR5 change) had no horizontal overflow containment — the
     wrapper renders outside the `s.shell` (no `maxWidth: 780`) and sits at root DOM level.
     Added `overflowX: "hidden"` to bound the section.
- The existing `html, body { overflow-x: hidden }` backstop in `src/index.css` is preserved.
- `tsc --noEmit && vite build` pass (474.57 kB JS / 9.30 kB CSS, 0 TS errors).
- PR #42 open: https://github.com/Terenc-LLC/alldeezmeals/pull/42

## Status (TER-291 — June 2026)
- "This Week" box: committed current-week recipe slot + review view.
- **`currentWeek` state**: `useState<any>(null)` wired through all four persistence points
  (localStorage load, Supabase load in sign-in effect, save payload object, save effect dep
  array). Shape: `{ startDate, numDays, entries: [{ day, date, meal }] }` — mirrors the
  `acceptedMealsForPrint` snapshot (meal.data incl. recipes, kcalInfo, etc.).
- **`commitCurrentWeek()`**: snapshots `acceptedMealsForPrint` + `startDate` + `numDays`
  into `currentWeek`. Shared entry point — TER-283's gate will call this same function.
- **Temporary trigger**: "Save this week" button (btn-secondary btn--sm) added to PlanView
  toolbar (shown when `acceptedCount > 0`). Superseded by TER-283.
- **"This Week" tab**: `CalendarDays` icon, positioned between Meals and List in the nav.
  Shows `ThisWeekView` component: list of committed recipe rows with thumbs up/down + ★
  save-to-rotation actions, plus per-recipe detail via `RecipeCard` (with optional
  `onThumbUp` / `onThumbDown` / `isLiked` props added to `RecipeCard`).
- **Mark ordered**: clears `currentWeek` (`setCurrentWeek(null)`) after `resetPlan()`.
  Confirm copy updated to mention This Week box is cleared.
- **Start over**: does NOT clear `currentWeek`; confirm copy updated to say This Week is kept.
- No DB migration — `currentWeek` is a new key in the existing `user_state` JSON blob.
  Old rows load fine (`d.currentWeek ?? null` guard in localStorage load; `!== undefined`
  guard in Supabase load per TER-189 pattern).
- `tsc --noEmit && vite build` pass (478.59 kB JS / 9.30 kB CSS, 0 TS errors).

## Status (TER-294 — June 2026)
- In-app feedback form → Supabase `feedback` table.
- **Migration** `supabase/migrations/20260601_007_feedback.sql`: creates `feedback` table
  `{ id uuid pk, user_id uuid default auth.uid() references auth.users, email text, category text,
  message text not null, app_context text, created_at timestamptz }`. RLS: INSERT-for-self
  (`user_id = auth.uid()`, authenticated only); restrictive `approved users only` policy added
  explicitly (new tables must opt in — migration 006 only patched tables that existed at that time).
  No SELECT policy for regular users; reads happen in the Supabase dashboard.
  **Must be run manually in the Supabase SQL editor before the feature works.**
- **Header button**: `MessageSquare` icon-button (lucide) added next to `HelpCircle` in the
  authenticated header, styled with `s.signOutBtn`. Toggles `feedbackOpen` state.
- **`FeedbackModal` component**: fixed-overlay modal (z-index 1000, click-outside to dismiss).
  Backdrop-click closes; X button in header also closes. Contains: optional `category` select
  (Bug / Idea / Other) + required `message` textarea + Submit / Cancel buttons. Submit disabled
  and visually muted when message is empty.
- **Submit**: `supabase.from("feedback").insert({ message, category, email, app_context: tab })`
  via anon key + user JWT — no service-role key, no serverless endpoint. On success: "Thanks —
  got it!" confirmation shown, modal auto-closes after 1.8 s. On error: message preserved,
  non-blocking error shown inline; user can retry.
- No new `:root` tokens or CSS class additions; uses existing `s` object + `.btn-primary` /
  `.btn-ghost` classes. Verified at 390px and desktop.
- `tsc --noEmit && vite build` pass.

## Status (TER-283 — June 2026)
- Meal review wizard: TOC list of meals, one expanded at a time.
- **`PlanView` refactored** from an all-meals-inline layout to a TOC accordion wizard.
  Each meal slot is always visible as a compact row (day label + meal name + status pill).
  Only the selected row is expanded to show full detail (description, times, kcal, difficulty,
  ingredient tags, steps, accept/reject/thumbs/rotation actions). Clicking a row expands it
  and collapses the previous selection. Generating, accepting, or rejecting a meal updates
  that row's status in-place without reflowing the surrounding list.
- **Status pills**: Pending (no meal) · Generating… (loading) · Review (ready, not yet acted) ·
  Accepted (green) · Error (red) · 📌 Pinned. Helper component: `TocStatusPill`.
- **Prev / Next navigation** buttons in the expanded panel allow stepping through days without
  clicking in the TOC list. Invisible (visibility:hidden) at the edges to preserve layout.
- **"All meals accepted" soft gate**: replaces the temporary "Save this week" button (removed).
  "Save to This Week" button + "Print recipes" ghost link appear below the TOC list when
  `acceptedCount > 0`. Clicking "Save to This Week" calls `commitCurrentWeek()` AND routes
  to the This Week tab via a combined `onAllAccepted` handler wired in App.
  Planner remains editable after committing (re-running re-commits to This Week).
- **New styles** added to `s` object: `tocRow`, `tocRowActive`, `tocSummary`, `tocLeft`,
  `tocDate`, `tocMealName`, `tocDetail`. Conventions: inline `s` + CSS vars; `.btn-*` classes.
- `ThisWeekView` empty-state hint copy updated to match new button label.
- `tsc --noEmit && vite build` pass (484.30 kB JS / 9.33 kB CSS, 0 TS errors).

## Status (TER-292 — June 2026)
- Nomenclature cleanup: user-facing "rotation/Saved" labels renamed to **"Recipe Box"** everywhere. Internal `rotation` / `setRotation` / `addToRotation` identifiers and the `rotation` persistence key in `user_state` are **unchanged** — renaming the key would orphan every user's saved recipes.
- **Files changed**: `src/App.tsx` (tab label, RotationView heading + empty-state, PlanView action button title + label, ThisWeekView row ★ title, RecipeCard footer button, SetupView pinned-recipe tooltips, Back button); `public/help.html` (5-minute run step, Meals ★ entry, Recipe Box section heading, tidy copy, new dual-★ Tips entry); `ALLDEEZMEALS_CONTEXT.md` (this entry + terminology update below).
- **Dual-★ convention** (documented; visual distinction unchanged):
  - **★ on a meal/recipe** (primary green — Meals / This Week / RecipeCard) = **Save to Recipe Box** — the saved-recipes pool, pinnable to a future day (TER-228).
  - **★ on a grocery row** (amber — ListView "Always have" panel) = **Always have** — a staple kept stocked, excluded from every weekly list (TER-182). Not renamed.
- `tsc --noEmit && vite build` pass.

## Terminology note
The permanent favorites pool is called **Recipe Box** in the UI. Internally, code identifiers remain `rotation` / `setRotation` / `addToRotation`; the Supabase `user_state` JSON key is `rotation`. Do not rename these internal identifiers.

## Status (TER-296 — June 2026)
- Bug fix: People count inputs (Setup default + per-day rows) couldn't be cleared; required select-all to change value.
- **Root cause**: both inputs coerced value on every keystroke via `Math.max(1, Number(e.target.value) || 1)`, so clearing the field snapped back to 1 immediately.
- **Fix**: extracted a shared `PeopleInput` wrapper component (just above `SetupView` in `src/App.tsx`). It holds a local `draft: string` state; `onFocus` selects all text; `onChange` updates the draft freely; `onBlur` clamps to `Math.max(1, parseInt(draft) || 1)` and calls the parent's `onChange` with a number. A `useEffect` syncs `draft` when the parent value changes externally (e.g., "set everyone to N"). Added `inputMode="numeric"` for mobile. Both inputs replaced with `<PeopleInput>`.
- No state shape change; no DB migration; plan generation + headcount scaling unaffected.
- `tsc --noEmit && vite build` pass (484.50 kB JS / 9.33 kB CSS, 0 TS errors).

## Status (TER-299 — June 2026)
- Bug fix: iOS Safari zooms on input focus (sub-16px fields) → horizontal overflow when keyboard opens.
- **Root cause**: iOS Safari auto-zooms the viewport when a focused `input`/`select`/`textarea` has `font-size < 16px`. All form fields use tokens below the 16px threshold (`--t-body-size: 15px`, `--t-bodysm-size: 13px`, `--t-label-size: 12px`). The existing `overflow-x: hidden` from TER-254 hides document overflow but cannot stop iOS focus-zoom (a visual viewport zoom — different mechanism).
- **Fix**: one new `@media (max-width: 767px)` rule appended to `src/index.css` clamps `input, select, textarea` to `font-size: 16px` on mobile. 16px is the iOS zoom threshold; at or above it, Safari does not zoom on focus. Desktop sizing unchanged; no viewport meta change.
- `tsc --noEmit && vite build` pass.

## Backlog / next
- TER-249 PR1–PR5 (design refresh Phase 1): all 5 PRs are open and awaiting Chris review/merge.
- TER-288: Order History view (surfaces archived orders from the `orders` table).
- TER-196: Calorie cascade + UI (depends on TER-194).
- TER-195: Fill nutrition columns on catalog rows (FDC GTIN + Open Food Facts).
- TER-198: Seed catalog with ALDI core-range items.
- TER-190: Per-user item affinity from item_usage purchase history.
- Optional: per-plan cost estimate (rough ALDI prices) and "reshuffle week" action.
- Optional: PWA / installable on phone.

## Known caveats
- Open-Meteo forecasts ~16 days out; beyond that, days fall back to neutral weather.
- AI ingredient quantities are estimates suitable for a shopping list, not exact recipes.
- Pre-TER-173 localStorage data is migrated to Supabase on first sign-in (TER-189). Each
  device's local data migrates under the first account to sign in there — if a device was
  shared pre-accounts, its local data imports under that first account only.
