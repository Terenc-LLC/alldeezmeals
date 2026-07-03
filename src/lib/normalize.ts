// TER-522: fold hyphens→spaces so display-key variants collapse
// (`long-grain white rice` ≡ `long grain white rice`). The fold runs after
// parenthetical stripping and before whitespace collapse so any spaces it
// introduces get folded into the single-space result. Word-order variants
// (`white long-grain rice`) are intentionally NOT handled here — token sorting
// is too risky for a display key (left to generation-vocabulary discipline).
export function normalizeIngName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// TER-330: forward-merge the legacy `pantry` exclusion list into `alwaysHave`.
// Historically two parallel "exclude from the buy list" sets existed: `pantry`
// (raw `name.toLowerCase()` keys) and `alwaysHave` (`normalizeIngName` keys).
// They are being collapsed onto the single normalized `alwaysHave` key. Each
// pantry entry is run through normalizeIngName so it dedupes against existing
// alwaysHave entries; the union is returned with no data loss. Used on every
// hydrate path so old persisted blobs migrate forward without dropping items.
//
// TER-522: the existing `alwaysHave` keys are ALSO re-run through
// normalizeIngName here — persisted keys predate the hyphen fold, so old
// variants (`long-grain white rice` vs `long grain white rice`) collapse via
// the Set union on load. Lossless: distinct keys stay distinct; only
// normalization-equal keys merge.
export function mergePantryIntoAlwaysHave(
  pantry: string[] | undefined | null,
  alwaysHave: string[] | undefined | null,
): string[] {
  const out = new Set<string>();
  for (const a of alwaysHave ?? []) {
    const k = normalizeIngName(a ?? "");
    if (k) out.add(k);
  }
  for (const p of pantry ?? []) {
    const k = normalizeIngName(p ?? "");
    if (k) out.add(k);
  }
  return [...out];
}

// Normalize UPC-A / EAN-13 / GTIN-14 to a canonical 14-digit string for comparison.
// Strips non-digits then left-pads with zeros so "048001206867" and "0048001206867"
// both become "00048001206867" and match each other.
export function normalizeGtin(gtin: string): string {
  return gtin.replace(/\D/g, "").padStart(14, "0");
}

// Strip non-digits from a barcode without padding — use for Open Food Facts URLs.
// OFF stores barcodes as-printed (UPC-A 12 / EAN-13 13); zero-padding to 14 breaks lookups.
export function gtinDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

// Snapshot assertions — fail loudly at import time if the logic ever drifts.
/* eslint-disable no-restricted-syntax */
const _checks: [string, string][] = [
  ["Garlic (organic)", "garlic"],
  ["  Olive  Oil  ", "olive oil"],
  ["Onion (yellow), diced", "onion , diced"],
  // TER-522: hyphens fold to spaces so hyphenated variants collapse.
  ["long-grain white rice", "long grain white rice"],
  ["long grain white rice", "long grain white rice"],
  ["extra-virgin olive oil", "extra virgin olive oil"],
];
for (const [input, expected] of _checks) {
  const got = normalizeIngName(input);
  if (got !== expected) throw new Error(`normalizeIngName: "${input}" → "${got}", expected "${expected}"`);
}
// TER-522: the two hyphen spellings of the same rice normalize identically.
if (normalizeIngName("long-grain white rice") !== normalizeIngName("long grain white rice")) {
  throw new Error("normalizeIngName: hyphen fold did not collapse rice variants");
}

// TER-330 merge: union + normalize + dedupe, lossless across both legacy keys.
{
  const merged = mergePantryIntoAlwaysHave(
    ["Olive Oil", "Garlic (organic)", "salt"],   // legacy raw-lowercased pantry keys
    ["garlic", "pepper"],                          // existing normalized alwaysHave keys
  );
  const expected = ["garlic", "pepper", "olive oil", "salt"]; // garlic deduped, no loss
  const ok = merged.length === expected.length && expected.every((e) => merged.includes(e));
  if (!ok) throw new Error(`mergePantryIntoAlwaysHave drift: got ${JSON.stringify(merged)}`);
}

// TER-522 hydrate re-normalization: pre-fold alwaysHave keys collapse on load.
{
  const merged = mergePantryIntoAlwaysHave(
    null,
    ["long-grain white rice", "long grain white rice", "extra-virgin olive oil"],
  );
  const expected = ["long grain white rice", "extra virgin olive oil"]; // rice dupes merged
  const ok = merged.length === expected.length && expected.every((e) => merged.includes(e));
  if (!ok) throw new Error(`mergePantryIntoAlwaysHave TER-522 drift: got ${JSON.stringify(merged)}`);
}

const _gtinChecks: [string, string][] = [
  ["048001206867", "00048001206867"],
  ["0048001206867", "00048001206867"],
  ["00048001206867", "00048001206867"],
  ["4-901234-567890", "04901234567890"],
];
for (const [input, expected] of _gtinChecks) {
  const got = normalizeGtin(input);
  if (got !== expected) throw new Error(`normalizeGtin: "${input}" → "${got}", expected "${expected}"`);
}

const _gtinDigitsChecks: [string, string][] = [
  ["048001206867", "048001206867"],
  ["0048001206867", "0048001206867"],
  ["4-901234-567890", "4901234567890"],
];
for (const [input, expected] of _gtinDigitsChecks) {
  const got = gtinDigits(input);
  if (got !== expected) throw new Error(`gtinDigits: "${input}" → "${got}", expected "${expected}"`);
}
