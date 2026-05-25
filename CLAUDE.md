# ALLDEEZMeals — Claude Code instructions

## Push-before-done rule

After every implementation task, push the branch to origin and confirm the remote commit SHA before reporting the work as complete. A local-only commit is not done.

```
git push -u origin <branch>
# confirm the SHA shown by git matches what's on origin
```

Do not say "done" until `git push` has succeeded and the SHA is verified against the remote.

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
