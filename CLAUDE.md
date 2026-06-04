# ALLDEEZMeals — Claude Code instructions

## Branch and PR rules

- **One branch per issue.** Create a fresh `feat/ter-NNN-…` branch off the latest `main` for each issue. Never re-push to a branch whose PR is already merged.
- **Every task ends with an open PR.** A local commit is not done. A pushed branch with no PR is not done. "Done" means: branch pushed, PR open on GitHub, PR URL reported.
- **Push-before-done.** After every implementation task, push to origin and confirm the remote commit SHA before reporting the work as complete.

```
git checkout main && git pull origin main
git checkout -b feat/ter-NNN-short-description
# … make changes …
git push -u origin feat/ter-NNN-short-description
gh pr create --base main …
```

Do not say "done" until `git push` has succeeded and a PR URL is confirmed on GitHub (not 404).

## Linear comment rule

After completing work on a Linear issue, post a full, detailed report as a comment on that issue using the Linear MCP tool (`mcp__claude_ai_Linear__save_comment`). Cover: what was done, files changed, decisions made, relevant links (PR URL, commit SHA).

## Build verification

Always run `tsc --noEmit && vite build` (or equivalently `npm run build`) before committing. Report the output (pass/fail, bundle sizes) in the Linear comment.

## Key env vars

| Var | Where | Purpose |
|-----|-------|---------|
| `ANTHROPIC_API_KEY` | Vercel server | Meal generation |
| `FDC_API_KEY` | Vercel server + local `.env` | USDA FDC nutrition proxy |
| `VITE_SUPABASE_URL` | Vercel + local `.env` | Supabase client |
| `VITE_SUPABASE_ANON_KEY` | Vercel + local `.env` | Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel server | Catalog ingestion (must be the legacy `eyJ…` JWT, not `sb_secret_…`) |

## Supabase service-role note

Use the **legacy service_role JWT** (starts with `eyJ…`) from Supabase → API Keys → "Legacy anon, service_role API keys". The new `sb_secret_…` format does not bypass RLS via supabase-js in this project.

## Normalizer rule

The parenthetical-stripping ingredient normalizer lives in `src/lib/normalize.ts` (`normalizeIngName`). Do not copy it elsewhere. The `normalized_product` logic in `api/ingest-order.ts` (lowercase+trim only, no parenthetical strip) is a separate normalizer for product names — leave it alone.

## Approval gate

Every new feature that touches auth must observe the following two rules:

- **New tables** readable or writable by authenticated users MUST include the restrictive `approved users only` policy in their migration (mirror migration 006/007 pattern: `as restrictive for all to authenticated using (public.is_approved())`). Tables that are service-role-only (no client-facing RLS policy — e.g. `shared_lists`, `recipe_library`) are exempt.
- **New authenticated, non-admin `/api` endpoints** MUST call `isApproved(token, userId)` (from `api/_approved.ts`) immediately after the successful `getUser` block and return `403 { error: "Account pending approval" }` if false. Exempt: `api/admin/*` (already admin-gated), `api/me.ts`, `api/shared-list/*` (public token links, no user auth).

## Recipe originality

All generated recipes must be original. The `buildPrompt` in `src/App.tsx` instructs the model to write original cooking directions and descriptions (not copied text); ingredient quantities/lists are fine. Only model-generated recipes enter the global `recipe_library` (TER-303/304); user-entered recipes (TER-234) are account-private and never sync to the shared library.
