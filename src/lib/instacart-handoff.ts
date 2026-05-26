import { normalizeIngName } from "./normalize";

// Instacart-supported units (Layer 3 of the Instacart Handoff Format Spec, TER-180).
// Source: docs.instacart.com/developer_platform_api/api/units_of_measurement (2026-05-26)
const SUPPORTED_UNITS = new Set([
  // Measured
  "cup", "cups", "c",
  "fl oz can", "fl oz container", "fl oz jar", "fl oz pouch", "fl oz ounce",
  "gallon", "gallons", "gal", "gals",
  "milliliter", "millilitre", "milliliters", "millilitres", "ml", "mls",
  "liter", "litre", "liters", "litres", "l",
  "pint", "pints", "pt", "pts", "pt container",
  "quart", "quarts", "qt", "qts",
  "tablespoon", "tablespoons", "tb", "tbs",
  "teaspoon", "teaspoons", "ts", "tsp", "tspn",
  // Weighed
  "gram", "grams", "g", "gs",
  "kilogram", "kilograms", "kg", "kgs",
  "lb bag", "lb can", "lb container", "lb", "per lb",
  "ounce", "ounces", "oz",
  "ounces bag", "oz bag", "ounces can", "oz can", "ounces container", "oz container",
  "pound", "pounds", "lbs",
  // Countable
  "bunch", "bunches", "can", "cans", "each", "ears",
  "head", "heads", "large", "lrg", "lge", "lg",
  "medium", "med", "md", "package", "packages", "packet",
  "small", "sm", "small ears", "small head", "small heads",
]);

// Rule 1: Whole countable produce → "each"
const COUNTABLE_PRODUCE = [
  "onion", "lemon", "lime", "avocado", "tomato", "potato", "apple", "orange",
  "pear", "peach", "plum", "mango", "garlic", "shallot", "zucchini", "cucumber",
  "carrot", "beet", "turnip", "radish", "pepper", "jalapeño", "jalapeno",
  "kiwi", "grapefruit", "banana",
];

// Rule 2: Leafy heads → "head"
const LEAFY_HEADS = ["lettuce", "cabbage", "radicchio", "endive", "bok choy", "romaine"];

// Rule 4: Compound container patterns → supported Instacart unit
const CONTAINER_PATTERNS: [RegExp, string][] = [
  [/fl\.?\s*oz\s+can/i, "fl oz can"],
  [/fl\.?\s*oz\s+container/i, "fl oz container"],
  [/fl\.?\s*oz\s+jar/i, "fl oz jar"],
  [/fl\.?\s*oz\s+pouch/i, "fl oz pouch"],
  [/fl\.?\s*oz/i, "fl oz ounce"],
  [/oz\s+can/i, "oz can"],
  [/oz\s+bag/i, "oz bag"],
  [/oz\s+container/i, "oz container"],
  [/lb\s+bag/i, "lb bag"],
  [/lb\s+can/i, "lb can"],
  [/lb\s+container/i, "lb container"],
  [/pt\s+container/i, "pt container"],
];

// Rule 5: Unsupported container words → "package"
const UNSUPPORTED_CONTAINER = /\b(box|tray|sleeve|tube|roll|stick|bottle)\b/i;

// Rule 6: Bare weight string — "2 lb", "16 oz", "500 g"
const BULK_WEIGHT_RE = /^(\d+(?:\.\d+)?)\s*(oz|lb|lbs?|g|kg)\s*$/i;
const WEIGHT_UNIT_MAP: Record<string, string> = { oz: "oz", lb: "lb", lbs: "lb", g: "g", kg: "kg" };

function isValidUpc(upc: string): boolean {
  const d = upc.replace(/\D/g, "");
  return d.length === 12 || d.length === 14;
}

export type NormalizedUnit = {
  unit: string;        // Instacart supported unit (Layer 1: line_item_measurements[].unit)
  qty: number;         // Line-item quantity
  textDisplay: string; // Text rendered after "—" in the handoff line
};

/**
 * Normalize a grocery item's purchaseSize + purchaseQty to an Instacart-supported unit.
 * Follows Layer 3 rules from the Instacart Handoff Format Spec (TER-180).
 *
 * Size-based rules (4-6) are checked first so that packaged items like "Diced tomatoes —
 * 14.5 oz can" don't get caught by the name-based produce rule (Rule 1).
 * Name-based rules (1-3) only fire when purchaseSize is vague (e.g. "each", "1 dozen").
 */
export function normalizeUnit(
  purchaseSize: string,
  purchaseQty: number,
  itemName: string,
): NormalizedUnit {
  const ps = purchaseSize.trim();
  const psLower = ps.toLowerCase();
  const nameNorm = normalizeIngName(itemName);

  // Rule 4 (checked first): Packaged item with a supported compound container unit
  for (const [re, unit] of CONTAINER_PATTERNS) {
    if (re.test(ps)) {
      return { unit, qty: purchaseQty, textDisplay: `${purchaseQty} × ${ps}` };
    }
  }

  // Rule 5: Unsupported container word (box, tray, etc.) → "package"
  if (UNSUPPORTED_CONTAINER.test(psLower)) {
    return { unit: "package", qty: purchaseQty, textDisplay: `${purchaseQty} × ${ps}` };
  }

  // Rule 6: Bare weight with no container — extract number as qty
  const bulkMatch = BULK_WEIGHT_RE.exec(ps);
  if (bulkMatch) {
    const weightNum = parseFloat(bulkMatch[1]);
    const unit = WEIGHT_UNIT_MAP[bulkMatch[2].toLowerCase()] ?? "lb";
    const total = weightNum * purchaseQty;
    return { unit, qty: total, textDisplay: `${total} ${unit}` };
  }

  // Direct match: purchaseSize is itself a supported unit
  if (SUPPORTED_UNITS.has(psLower)) {
    return { unit: psLower, qty: purchaseQty, textDisplay: `${purchaseQty} ${ps}` };
  }

  // Rule 1: Whole countable produce → "each" (purchaseSize is vague, use item name)
  if (COUNTABLE_PRODUCE.some((kw) => nameNorm.includes(kw))) {
    return { unit: "each", qty: purchaseQty, textDisplay: `${purchaseQty} each` };
  }

  // Rule 2: Leafy heads → "head"
  if (LEAFY_HEADS.some((kw) => nameNorm.includes(kw))) {
    return { unit: "head", qty: purchaseQty, textDisplay: `${purchaseQty} head` };
  }

  // Rule 3: Eggs → "large", qty = dozens × 12; render as "N dozen"
  if (/\begg(s)?\b/i.test(nameNorm)) {
    const dozenLabel = purchaseQty === 1 ? "1 dozen" : `${purchaseQty} dozen`;
    return { unit: "large", qty: purchaseQty * 12, textDisplay: dozenLabel };
  }

  // Rule 7: Unsure → "package"
  const display = ps
    ? purchaseQty <= 1 ? ps : `${purchaseQty} × ${ps}`
    : `${purchaseQty} package`;
  return { unit: "package", qty: purchaseQty, textDisplay: display };
}

// Internal line-item model (Layer 1 of the spec — API-aligned for future IDP path).
export type InstacartLineItem = {
  name: string;          // LineItem.name (required)
  display_text: string;  // LineItem.display_text
  quantity: number;      // LineItem.line_item_measurements[].quantity
  unit: string;          // LineItem.line_item_measurements[].unit
  upc?: string;          // LineItem.upcs[] (12- or 14-digit, optional hint)
};

export type InstacartHandoff = {
  preamble: string;
  lines: string[];
  lineItems: InstacartLineItem[];
};

export const INSTACART_PREAMBLE =
  "Add these items to my Instacart cart, matching each to the closest available\n" +
  "product. The number before each item is how many packages to buy. After building\n" +
  "the cart, give me the link so I can pick my store and check out.";

const CATEGORIES_ORDER = [
  "Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry", "Frozen", "Bakery", "Other",
];

/**
 * Build a matcher-aligned Instacart handoff from the buy-only grocery list and catalog.
 * The text path (preamble + lines) is what gets copied to clipboard today.
 * The lineItems model is API-aligned for a future POST /idp/v1/products/products_link.
 */
export function buildInstacartHandoff(
  groceryList: Record<string, Array<{ name: string; qty: number; unit: string }>>,
  catalog: Array<{ normalized_name?: string | null; upc?: string | null }> = [],
): InstacartHandoff {
  // Build lookup: normalizedIngName → first valid UPC in catalog
  const catalogMap = new Map<string, string>();
  for (const item of catalog) {
    if (item.normalized_name && item.upc && isValidUpc(item.upc)) {
      const key = normalizeIngName(item.normalized_name);
      if (!catalogMap.has(key)) catalogMap.set(key, item.upc);
    }
  }

  const lineItems: InstacartLineItem[] = [];
  const lines: string[] = [];
  const seenUpcs = new Set<string>(); // de-dupe UPCs across line items

  for (const cat of CATEGORIES_ORDER) {
    const items = groceryList[cat];
    if (!items?.length) continue;
    for (const it of items) {
      if (!it.qty || it.qty <= 0) continue; // spec: exclude zero-qty
      const purchaseQty = Math.max(1, Math.round(it.qty));
      const { unit, qty, textDisplay } = normalizeUnit(it.unit || "", purchaseQty, it.name);

      // Catalog UPC hint (best-effort, de-duped)
      const normKey = normalizeIngName(it.name);
      let upc: string | undefined;
      const hit = catalogMap.get(normKey);
      if (hit && !seenUpcs.has(hit)) {
        upc = hit;
        seenUpcs.add(hit);
      }

      const sizeLabel = (it.unit || "").trim();
      lineItems.push({
        name: it.name,
        display_text: sizeLabel ? `${it.name} (${sizeLabel})` : it.name,
        quantity: qty,
        unit,
        ...(upc ? { upc } : {}),
      });

      const upcSuffix = upc ? `  [UPC ${upc}]` : "";
      lines.push(`- ${it.name} — ${textDisplay}${upcSuffix}`);
    }
  }

  return { preamble: INSTACART_PREAMBLE, lines, lineItems };
}
