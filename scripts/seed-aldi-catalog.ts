/**
 * scripts/seed-aldi-catalog.ts
 *
 * One-time script: seeds the shared `catalog` table with ALDI private-label items
 * sourced from an Open Food Facts (OFF) TSV export.
 *
 * =============================================================================
 * REQUIRED ENV VARS (from .env — gitignored; load before running):
 *   VITE_SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — LEGACY service_role JWT (starts "eyJ…")
 *                                ⚠️  NOT the new "sb_secret_…" format.
 *                                    The new format does NOT bypass RLS via
 *                                    supabase-js and inserts 0 rows silently.
 *
 * WHERE TO GET THE OFF DATA FILE:
 *   https://world.openfoodfacts.org/data/en.openfoodfacts.org.products.csv
 *   (~9 GB compressed, ~30 GB uncompressed). Tab-separated despite the .csv name.
 *
 * RUN:
 *   # Load env vars first:
 *   export $(grep -v '^#' .env | xargs)
 *
 *   # Full run:
 *   npx tsx scripts/seed-aldi-catalog.ts /path/to/en.openfoodfacts.org.products.csv
 *
 *   # Dry-run (counts + logs, no DB writes):
 *   npx tsx scripts/seed-aldi-catalog.ts /path/to/file.csv --dry-run
 *
 *   # Typecheck this script (scripts/ is excluded from the main tsconfig):
 *   npx tsc -p tsconfig.scripts.json --noEmit
 * =============================================================================
 */

import * as fs from "fs";
import * as readline from "readline";
import { createClient } from "@supabase/supabase-js";
// Import from the shared normalizer — do not copy this logic elsewhere.
// The module-level snapshot assertions in normalize.ts verify correct behaviour
// and pass safely on import.
import { normalizeIngName } from "../src/lib/normalize.ts";

// ── ALDI private-label brands ─────────────────────────────────────────────────
// Extend this list as new ALDI sub-brands are identified.
const ALDI_BRANDS = [
  "Simply Nature",
  "Clancy's",
  "Specially Selected",
  "Baker's Corner",
  "Carlini",
  "Friendly Farms",
  "Millville",
  "Fit & Active",
  "Never Any!",
  "Park Street Deli",
  "Season's Choice",
  "Reggano",
  "Burman's",
  "Tuscan Garden",
] as const;

const ALDI_BRANDS_LOWER = ALDI_BRANDS.map((b) => b.toLowerCase());

const BATCH_SIZE = 500;

// ── Dedup key: must match toNormalizedProduct in api/ingest-order.ts exactly ──
// normalized_product = lowercase + collapse-spaces + trim of product_name.
// Seed rows and receipt rows dedup against each other on this key via the
// catalog.normalized_product unique constraint.
function toNormalizedProduct(productName: string): string {
  return productName.trim().toLowerCase().replace(/\s+/g, " ").trim();
}

// ── Map OFF categories_tags → app category set ────────────────────────────────
function mapCategory(categoriesTags: string): string {
  const t = categoriesTags.toLowerCase();
  // Frozen first: frozen items often also match other category keywords.
  if (/\bfrozen\b/.test(t)) return "Frozen";
  if (/\b(meats?|seafood|fish|poultry|beef|chicken|pork|turkey|salmon|shrimp|tuna|sausage|bacon|ham)\b/.test(t))
    return "Meat & Seafood";
  if (/\b(dairy|milks?|cheeses?|yogurts?|yoghurts?|butters?|creams?|eggs?)\b/.test(t))
    return "Dairy & Eggs";
  if (/\b(fruits?|vegetables?|produce|fresh-fruits?|fresh-vegetables?)\b/.test(t))
    return "Produce";
  if (/\b(breads?|bakery|baked|pastry|pastries|cakes?|cookies?|crackers?|muffins?|rolls?|biscuits?)\b/.test(t))
    return "Bakery";
  if (/\b(canned|pasta|rice|beans?|lentils?|oils?|vinegar|spices?|sauces?|condiment|baking|cereals?|grains?|nuts?|snacks?|candies?|candy|chocolate|beverages?|drinks?|soup|coffee|tea)\b/.test(t))
    return "Pantry";
  return "Other";
}

// ── Strip an ALDI brand from a product name (best-effort for normalized_name) ─
function stripBrand(productName: string, brand: string): string {
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return productName
    .replace(new RegExp(escaped, "gi"), "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Find which ALDI brand (lowercased) the brands field matches, or null ──────
function matchAldiBrand(brandsField: string): string | null {
  const tokens = brandsField
    .toLowerCase()
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  for (const brand of ALDI_BRANDS_LOWER) {
    if (tokens.some((tok) => tok === brand || tok.includes(brand))) {
      return brand;
    }
  }
  return null;
}

// ── Parse column indices from the TSV header row ──────────────────────────────
const REQUIRED_COLS = ["code", "product_name", "brands", "brands_tags", "quantity", "categories_tags"] as const;
type ColName = (typeof REQUIRED_COLS)[number];

function parseHeaders(headerLine: string): Record<ColName, number> {
  const cols = headerLine.split("\t");
  const idx = {} as Record<ColName, number>;
  for (const key of REQUIRED_COLS) {
    idx[key] = cols.indexOf(key);
  }
  return idx;
}

type CatalogRow = {
  normalized_product: string;
  normalized_name: string;
  product_name: string;
  brand: string;
  category: string;
  package_size: string | null;
  upc: string;
  source: "seed";
};

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const csvPath = args.find((a) => !a.startsWith("--"));
  const dryRun = args.includes("--dry-run");

  if (!csvPath) {
    console.error("Usage: npx tsx scripts/seed-aldi-catalog.ts <path-to-off-tsv> [--dry-run]");
    process.exit(1);
  }
  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!dryRun) {
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing env: VITE_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
      process.exit(1);
    }
    if (!serviceRoleKey.startsWith("eyJ")) {
      console.error(
        "⚠️  SUPABASE_SERVICE_ROLE_KEY must be the LEGACY JWT (starts 'eyJ…').\n" +
          "   The new 'sb_secret_…' format does NOT bypass RLS — inserts 0 rows silently.",
      );
      process.exit(1);
    }
  }

  const svc = !dryRun ? createClient(supabaseUrl as string, serviceRoleKey as string) : null;

  console.log(dryRun ? "DRY-RUN mode — no DB writes." : "Live mode — writing to Supabase.");
  console.log(`Streaming: ${csvPath}\n`);

  const rl = readline.createInterface({
    input: fs.createReadStream(csvPath),
    crlfDelay: Infinity,
  });

  let lineNum = 0;
  let idx: Record<ColName, number> | null = null;
  let batch: CatalogRow[] = [];

  let totalScanned = 0;
  let totalSkippedNoData = 0;
  let totalFiltered = 0;
  let totalAttempted = 0;
  let totalInserted = 0;
  let totalConflicts = 0;
  let totalErrors = 0;
  let batchNum = 0;

  async function flushBatch() {
    if (batch.length === 0) return;
    const chunk = batch.splice(0);
    batchNum++;
    totalAttempted += chunk.length;

    if (dryRun) {
      console.log(`  [dry-run] batch ${batchNum}: would upsert ${chunk.length} rows`);
      return;
    }

    const { data, error } = await svc!
      .from("catalog")
      .upsert(chunk, { onConflict: "normalized_product", ignoreDuplicates: true })
      .select("id");

    if (error) {
      console.error(`  batch ${batchNum} error: ${error.message}`);
      totalErrors += chunk.length;
    } else {
      const inserted = (data ?? []).length;
      const conflicts = chunk.length - inserted;
      totalInserted += inserted;
      totalConflicts += conflicts;
      console.log(
        `  batch ${batchNum}: ${inserted} inserted, ${conflicts} skipped (conflict) [total attempted: ${totalAttempted}]`,
      );
    }
  }

  for await (const rawLine of rl) {
    lineNum++;
    const line = rawLine.trimEnd(); // remove \r on Windows-style line endings

    if (lineNum === 1) {
      idx = parseHeaders(line);
      const missing = (Object.entries(idx) as [ColName, number][])
        .filter(([, v]) => v === -1)
        .map(([k]) => k);
      if (missing.length > 0) {
        console.error(`Header missing expected columns: ${missing.join(", ")}`);
        process.exit(1);
      }
      console.log("Header parsed. Starting scan…\n");
      continue;
    }

    totalScanned++;
    if (totalScanned % 1_000_000 === 0) {
      console.log(`  scanned ${totalScanned.toLocaleString()} rows…`);
    }

    const cols = line.split("\t");
    const get = (col: ColName) => cols[idx![col]]?.trim() ?? "";

    const code = get("code");
    const productName = get("product_name");
    const brands = get("brands");
    const packageSize = get("quantity") || null;
    const categoriesTags = get("categories_tags");

    // Skip rows without a barcode or product name — not catalog-usable.
    if (!code || !productName) {
      totalSkippedNoData++;
      continue;
    }

    const matchedBrandLower = matchAldiBrand(brands);
    if (!matchedBrandLower) continue;

    totalFiltered++;

    const normalizedProduct = toNormalizedProduct(productName);

    // Best-effort generic key: strip the brand prefix, then normalize.
    // Inherently fuzzy (product→generic is not exact); don't over-engineer.
    const canonicalIdx = ALDI_BRANDS_LOWER.indexOf(matchedBrandLower);
    const canonicalBrand = ALDI_BRANDS[canonicalIdx];
    const nameWithoutBrand = stripBrand(productName, canonicalBrand);
    const normalizedName = normalizeIngName(nameWithoutBrand || productName);

    batch.push({
      normalized_product: normalizedProduct,
      normalized_name: normalizedName,
      product_name: productName,
      brand: canonicalBrand,
      category: mapCategory(categoriesTags),
      package_size: packageSize,
      upc: code,
      source: "seed",
    });

    if (batch.length >= BATCH_SIZE) {
      await flushBatch();
    }
  }

  await flushBatch();

  console.log("\n── Seed complete ──────────────────────────────────────────────────────");
  console.log(`  Rows scanned:          ${totalScanned.toLocaleString()}`);
  console.log(`  Skipped (no UPC/name): ${totalSkippedNoData.toLocaleString()}`);
  console.log(`  Matched ALDI brand:    ${totalFiltered.toLocaleString()}`);
  if (!dryRun) {
    console.log(`  Attempted upsert:      ${totalAttempted.toLocaleString()}`);
    console.log(`  Inserted (new rows):   ${totalInserted.toLocaleString()}`);
    console.log(`  Skipped (conflict):    ${totalConflicts.toLocaleString()}`);
    if (totalErrors > 0) {
      console.log(`  ⚠️  Errors:            ${totalErrors.toLocaleString()}`);
    }
  }
  console.log("───────────────────────────────────────────────────────────────────────");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
