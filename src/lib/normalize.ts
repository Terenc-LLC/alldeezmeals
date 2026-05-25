export function normalizeIngName(name: string): string {
  return name.toLowerCase().trim().replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
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
