/**
 * scripts/backfill-normalized-name.ts
 *
 * One-time backfill: rewrites every catalog row's normalized_name to
 * normalizeIngName canonical form (parenthetical-strip + whitespace-collapse).
 *
 * Previously the column was stored as trim().toLowerCase() only (ingest-order.ts).
 * After this backfill, ingest-order.ts writes normalizeIngName() so new rows land
 * in canonical form and the scoped .in("normalized_name", names) query in ListView
 * gets exact matches instead of silent misses.
 *
 * RUN:
 *   export $(grep -v '^#' .env | xargs)
 *   npx tsx scripts/backfill-normalized-name.ts
 *
 *   # Dry-run (shows what would change, no writes):
 *   npx tsx scripts/backfill-normalized-name.ts --dry-run
 *
 *   # Typecheck:
 *   npx tsc -p tsconfig.scripts.json --noEmit
 */

import { createClient } from "@supabase/supabase-js";
import { normalizeIngName } from "../src/lib/normalize.ts";

const PAGE_SIZE = 1000;

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing env: VITE_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!serviceRoleKey.startsWith("eyJ")) {
    console.error(
      "⚠️  SUPABASE_SERVICE_ROLE_KEY must be the LEGACY JWT (starts 'eyJ…').\n" +
        "   The new 'sb_secret_…' format does NOT bypass RLS — updates 0 rows silently.",
    );
    process.exit(1);
  }

  const svc = createClient(supabaseUrl, serviceRoleKey);

  console.log(dryRun ? "DRY-RUN mode — no DB writes." : "Live mode — writing to Supabase.");

  let offset = 0;
  let totalScanned = 0;
  let totalChanged = 0;
  let totalErrors = 0;

  while (true) {
    const { data, error } = await svc
      .from("catalog")
      .select("id, normalized_name")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error(`Fetch error at offset ${offset}:`, error.message);
      process.exit(1);
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      totalScanned++;
      if (!row.normalized_name) continue;

      const canonical = normalizeIngName(row.normalized_name);
      if (canonical === row.normalized_name) continue;

      totalChanged++;
      if (dryRun) {
        console.log(`  [dry-run] ${JSON.stringify(row.normalized_name)} → ${JSON.stringify(canonical)}`);
        continue;
      }

      const { error: updateErr } = await svc
        .from("catalog")
        .update({ normalized_name: canonical })
        .eq("id", row.id);

      if (updateErr) {
        console.error(`  update failed for id=${row.id}:`, updateErr.message);
        totalErrors++;
      }
    }

    offset += data.length;
    if (data.length < PAGE_SIZE) break;
  }

  console.log("\n── Backfill complete ──────────────────────────────────────────────────");
  console.log(`  Rows scanned:  ${totalScanned}`);
  console.log(`  Rows ${dryRun ? "would update" : "updated"}:  ${totalChanged}`);
  if (!dryRun && totalErrors > 0) {
    console.log(`  ⚠️  Errors:    ${totalErrors}`);
  }
  console.log("───────────────────────────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
