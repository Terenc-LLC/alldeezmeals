# ALLDEEZMeals

An ALDI-oriented family meal planner. Set a start date, pick how many people eat each
night and the vibe (cuisine + hot/cold), and it generates weather-aware dinners you can
accept/reject. It reuses ingredients across the week (whole chicken, bulk-poach & shred
chicken), always folds in your standing breakfast/lunch staples, and produces one
categorized ALDI shopping list. It learns taste via thumbs up/down and a saved rotation.

## Stack

- **Frontend:** Vite + React 18 + TypeScript + Tailwind
- **Weather:** Open-Meteo (free, keyless, called directly from the browser)
- **Meal generation:** Anthropic API via a serverless proxy at `/api/generate`
- **Storage:** `localStorage` (per device)
- **Hosting:** Vercel

## Architecture note (why the proxy exists)

The Anthropic API key must never ship to the browser. The React app calls its own
`/api/generate` endpoint; that serverless function (server-side only) adds the key and
forwards the request to Anthropic. Weather needs no key, so it is called directly.

## Local development

```bash
npm install
cp .env.example .env        # add your ANTHROPIC_API_KEY and APP_PASSPHRASE
npm run dev
```

Note: `/api/generate` runs as a Vercel function. For full local testing of generation,
use `vercel dev` (Vercel CLI) so the function and env var load; `npm run dev` alone serves
only the frontend.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Server (Vercel) | Anthropic API key — never sent to browser |
| `APP_PASSPHRASE` | Server (Vercel) | Shared secret; `/api/generate` returns 401 without it. Server returns 500 if not set. |

**How passphrase auth works:** On first visit, users are shown a simple gate screen and
prompted to enter the household passphrase. It is saved to `localStorage` and sent as the
`x-app-key` header on every generation request. A wrong passphrase gets a 401 and
re-prompts. The passphrase persists in the browser between visits; the logout button clears
it. There is no `VITE_APP_PASSPHRASE` — no secret lives in the JS bundle.

**Security note:** This is a single shared household secret, not per-user accounts. The
hard backstop remains a low monthly spend cap on the API key.

## Deploy to Vercel

1. Push this repo to GitHub (done).
2. In Vercel: **New Project → Import** `Terenc-LLC/alldeezmeals`.
3. Framework preset auto-detects **Vite**. No build changes needed.
4. **Settings → Environment Variables:** add `ANTHROPIC_API_KEY` and `APP_PASSPHRASE`
   (Production + Preview). No client-side env vars needed.
5. **Important:** if you previously set `VITE_APP_PASSPHRASE` in Vercel, delete it — it is
   no longer used and would expose the secret in the bundle.
6. Deploy.

## Cost

Meal generation is the only paid call. At Sonnet 4.6 rates ($3 / $15 per million tokens),
a full week is a few cents; a year of weekly planning is a couple of dollars. Switch the
`model` in `api/generate.ts` to Haiku to cut it further. Set a low monthly spend cap on
the API key.

## Model

`api/generate.ts` defaults to `claude-sonnet-4-6`. Cheaper option:
`claude-haiku-4-5-20251001`.
