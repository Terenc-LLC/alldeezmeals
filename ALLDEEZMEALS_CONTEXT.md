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

## Status (TER-177/178/180 — May 2026)
- Scaffold builds clean (`vite build` OK).
- Frontend ported from the Claude artifact prototype.
- Passphrase gate (TER-177): `/api/generate` requires `x-app-key` header matching `APP_PASSPHRASE` env var. Returns 401 otherwise. `VITE_APP_PASSPHRASE` sent from client on every call.
- Full recipes (TER-178): generation now returns `prepMinutes`, `cookMinutes`, `steps[]`. max_tokens bumped to 2000. Displayed on meal cards. "Print recipes" prints all accepted meals as a clean recipe sheet.
- Instacart copy (TER-180): "Copy for Instacart" on List tab copies a ChatGPT-ready prompt for ALDI ordering.
- Three env vars required: `ANTHROPIC_API_KEY` (server), `APP_PASSPHRASE` (server), `VITE_APP_PASSPHRASE` (client, must equal APP_PASSPHRASE).

## Backlog / next
- Verify end-to-end generation on a Vercel preview deploy (all three env vars set).
- Optional: Supabase persistence so Jen can use it on her own device.
- Optional: per-plan cost estimate (rough ALDI prices) and "reshuffle week" action.
- Optional: PWA / installable on phone.

## Known caveats
- Open-Meteo forecasts ~16 days out; beyond that, days fall back to neutral weather.
- AI ingredient quantities are estimates suitable for a shopping list, not exact recipes.
- localStorage is per-device until/unless Supabase is added.
