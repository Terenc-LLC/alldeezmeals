# ALLDEEZMEALS_CONTEXT

## Overview
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
- Instacart copy (TER-180): "Copy for Instacart" on List tab copies a ChatGPT-ready prompt.
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
  TER-173 catalog shell and recreates it with the full target shape: `normalized_name` (unique join
  key), `product_name`, `brand`, `category`, `package_size`, `upc`, `last_price_cents`,
  `last_seen_at`, nutrition columns (blank, for TER-195), `source`, `created_at`, `updated_at`.
  RLS re-applied: SELECT for any authenticated user; no client INSERT/UPDATE/DELETE policy (service
  role only). `item_usage.catalog_id` FK dropped before the table recreate and re-added after.
  **TER-195 and TER-198 must populate existing columns, not add new migrations.**
- **`/api/ingest-order.ts`** (new serverless function): validates Bearer JWT with the anon key,
  derives `user_id` from the validated JWT (never from client input — the service role bypasses RLS
  so ownership enforcement lives in code). Uses `SUPABASE_SERVICE_ROLE_KEY` to upsert the shared
  `catalog` on `normalized_name` (only non-nutrition columns specified, so nutrition cols survive
  re-submit). Upserts per-user `item_usage` with select+increment for `purchase_count`. Skips
  refunds and rows the user unchecked in the review table (keyed off `isRefund` and `include`).
- **Receipt tab** added to the app (5th tab, ReceiptText icon). Three-state flow:
  1. Paste: user pastes ALDI order confirmation or receipt text.
  2. Parse: calls `/api/generate` (Haiku for cost) with a structured extraction prompt → JSON
     array of `{ normalizedName, productName, brand, category, packageSize, qty, unitPriceCents,
     upc, isRefund }`. Refunds default to unchecked; user can toggle any row.
  3. Review: editable table (normalizedName, size, qty, price) → "Log N items to catalog" calls
     `/api/ingest-order` → success screen with count.
- **`SUPABASE_SERVICE_ROLE_KEY`** must be set server-side (Vercel + local `.env`). Already live in
  prod per prereq confirmed in issue. Added to `.env.example`.
- Known v1 limitation: re-submitting the same receipt re-increments `item_usage.purchase_count`.
  Acceptable for v1; optionally guard later by hashing the order ID.
- `tsc --noEmit && vite build` pass.

## Backlog / next
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
