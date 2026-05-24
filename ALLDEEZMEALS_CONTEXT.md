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

## Status (TER-184/185/181-partial — May 2026)
- List hygiene (TER-184): `purchaseQty` floored at 1 (no zero-qty lines). Ingredient names
  normalized (lowercase, strip trailing parentheticals) before aggregation so near-dupes like
  "sour cream" + "sour cream (full fat)" merge into one line. Zero-qty items filtered from
  the rendered list and copy/Instacart text. Normalization is conservative — distinct items
  (salted vs unsalted butter, corn vs flour tortillas) are not merged.
- Generation tuning (TER-185): `buildPrompt` now explicitly biases toward ALDI-stocked
  mainstream items and instructs the model to omit common pantry seasonings (salt, pepper,
  dried spices) and basic cooking oils from the purchase list by default (they still appear
  in cooking steps; a defining/central spice may still be purchased at model's judgment).
- "Start over" (TER-181, localStorage half): a "Start over" button in Setup tab (below
  "Generate meal plan") clears `meals` and `checkedItems` after a confirm dialog. Keeps
  all day configuration, staples, pantry/have-it list, and preferences (liked/avoid/rotation).
  (The "Mark as ordered" archive half of TER-181 is deferred pending Supabase.)

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

## Backlog / next
- TER-188: Add Supabase JWT validation to `/api/generate` (replace the stub comment).
- TER-173: Per-user schema + RLS (references `auth.uid()` — needs TER-187 first).
- TER-189: Data migration (post TER-173).
- Optional: per-plan cost estimate (rough ALDI prices) and "reshuffle week" action.
- Optional: PWA / installable on phone.

## Known caveats
- Open-Meteo forecasts ~16 days out; beyond that, days fall back to neutral weather.
- AI ingredient quantities are estimates suitable for a shopping list, not exact recipes.
- localStorage is per-device until TER-173 (Supabase schema) lands.
- `/api/generate` has no server-side auth check between TER-187 and TER-188; access is
  gated by the Supabase sign-in wall on the client (invite-only). TER-188 closes this gap.
