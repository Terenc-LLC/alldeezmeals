export function normalizeIngName(name: string): string {
  return name.toLowerCase().trim().replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
}

// Normalize UPC-A / EAN-13 / GTIN-14 to a canonical 14-digit string for comparison.
// Strips non-digits then left-pads with zeros so "048001206867" and "0048001206867"
// both become "00048001206867" and match each other.
export function normalizeGtin(gtin: string): string {
  return gtin.replace(/\D/g, "").padStart(14, "0");
}

// Snapshot assertions — fail loudly at import time if the logic ever drifts.
/* eslint-disable no-restricted-syntax */
const _checks: [string, string][] = [
  ["Garlic (organic)", "garlic"],
  ["  Olive  Oil  ", "olive oil"],
  ["Onion (yellow), diced", "onion , diced"],
];
for (const [input, expected] of _checks) {
  const got = normalizeIngName(input);
  if (got !== expected) throw new Error(`normalizeIngName: "${input}" → "${got}", expected "${expected}"`);
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
