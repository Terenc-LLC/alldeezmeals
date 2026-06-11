// TER-401: deterministic post-generation allergy/avoid guard.
//
// This is RISK REDUCTION, not an allergen-safety guarantee. The expansion table
// maps an avoid term to common derived/hidden forms so "pork" also catches
// chorizo, bacon, lard, etc. The table is intentionally conservative:
// false-positive over-blocking is the acceptable error direction (e.g. "sausage"
// matches for pork even though turkey sausage exists, and "butter" matches for
// milk even though peanut butter is dairy-free). Never use this module to CLAIM
// safety in UI copy — the "verify every label" disclaimer stays regardless.

import { normalizeIngName } from "./normalize";

export type AvoidHit = {
  term: string;
  matchedText: string;
  where: "ingredient" | "name" | "step";
};

export type RecipeLike = {
  name?: string;
  ingredients?: Array<{ name?: string }>;
  steps?: string[];
};

// Canonical term → derived/hidden forms. Keys are normalized (lowercase,
// singular-ish). Covers the FDA Big-9 allergens plus common restrictions.
const WHEAT_FORMS = [
  "flour", "bread", "breadcrumb", "panko", "pasta", "noodle", "spaghetti",
  "macaroni", "couscous", "semolina", "farro", "bulgur", "orzo", "seitan",
  "cracker", "crouton", "pita", "naan", "gnocchi", "udon", "ramen",
];

const EXPANSIONS: Record<string, string[]> = {
  milk: [
    "dairy", "cheese", "butter", "cream", "yogurt", "ghee", "whey", "casein",
    "lactose", "buttermilk", "mozzarella", "cheddar", "parmesan", "feta",
    "ricotta", "brie", "gouda", "queso", "ice cream", "custard", "half and half",
  ],
  egg: [
    "mayonnaise", "mayo", "aioli", "meringue", "frittata", "omelet", "omelette",
    "hollandaise", "custard", "albumen",
  ],
  fish: [
    "salmon", "tuna", "cod", "tilapia", "halibut", "trout", "anchovy",
    "anchovies", "sardine", "mahi", "snapper", "catfish", "fish sauce",
    "worcestershire",
  ],
  shellfish: [
    "shrimp", "prawn", "crab", "lobster", "scallop", "clam", "mussel", "oyster",
    "crawfish", "crayfish", "calamari", "squid", "octopus",
  ],
  "tree nut": [
    "nut", "almond", "cashew", "walnut", "pecan", "pistachio", "hazelnut",
    "macadamia", "brazil nut", "pine nut", "praline", "marzipan", "nutella",
    "frangipane", "nougat",
  ],
  peanut: ["peanut butter", "peanut oil", "satay", "groundnut"],
  wheat: WHEAT_FORMS,
  gluten: [...WHEAT_FORMS, "wheat", "barley", "rye", "malt", "beer", "soy sauce"],
  soy: ["soy sauce", "soybean", "tofu", "edamame", "tempeh", "miso", "tamari"],
  sesame: ["tahini", "sesame oil", "sesame seed", "halva"],
  pork: [
    "bacon", "ham", "chorizo", "prosciutto", "pancetta", "sausage", "lard",
    "pepperoni", "salami", "carnitas", "guanciale", "mortadella", "spam",
    "hot dog", "bratwurst", "kielbasa", "capicola",
  ],
  beef: [
    "steak", "brisket", "veal", "oxtail", "pastrami", "corned beef", "burger",
    "hamburger", "ribeye", "sirloin", "chuck roast", "beef broth",
  ],
  alcohol: [
    "wine", "beer", "vodka", "rum", "whiskey", "whisky", "bourbon", "brandy",
    "sherry", "marsala", "mirin", "sake", "tequila", "gin", "liqueur", "cognac",
    "vermouth",
  ],
};

// Common user phrasings → canonical expansion key.
const ALIASES: Record<string, string> = {
  dairy: "milk",
  lactose: "milk",
  "tree nuts": "tree nut",
  treenut: "tree nut",
  nut: "tree nut",
  nuts: "tree nut",
  groundnut: "peanut",
  shrimp: "shellfish",
  booze: "alcohol",
};

function singularize(t: string): string {
  return t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t;
}

function canonicalKey(term: string): string | null {
  const t = normalizeIngName(term);
  for (const candidate of [t, singularize(t)]) {
    if (EXPANSIONS[candidate]) return candidate;
    if (ALIASES[candidate]) return ALIASES[candidate];
  }
  return null;
}

// All match forms for one avoid term: the term itself plus table expansions.
export function expandAvoidTerm(term: string): string[] {
  const t = normalizeIngName(term);
  const key = canonicalKey(t);
  const forms = [t, ...(key ? [key, ...EXPANSIONS[key]] : [])];
  return Array.from(new Set(forms.filter(Boolean)));
}

// Word-boundary regex with optional plural suffix. "pine nut" matches
// "pine nuts" but never "pineapple"; "peanut butter" never matches "butter".
function formRegex(form: string): RegExp {
  const esc = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${esc}(?:s|es)?\\b`, "i");
}

// Light normalize for dish name and step text — lowercase + collapse
// whitespace, but KEEP parentheticals (a violation may hide inside one).
function normText(text: string): string {
  return String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Merge term lists into a normalized, deduped list (order-preserving).
export function mergeTerms(...lists: string[][]): string[] {
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list ?? []) {
      const t = normalizeIngName(raw);
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

// Scan a recipe against the avoid terms. Returns one hit per (term, field)
// occurrence: every ingredient, the dish name, and every step is checked.
export function checkRecipe(recipe: RecipeLike, avoidTerms: string[]): AvoidHit[] {
  const hits: AvoidHit[] = [];
  if (!recipe || !avoidTerms?.length) return hits;
  for (const term of mergeTerms(avoidTerms)) {
    const regexes = expandAvoidTerm(term).map(formRegex);
    const scan = (hay: string, where: AvoidHit["where"]) => {
      for (const re of regexes) {
        const m = hay.match(re);
        if (m) { hits.push({ term, matchedText: m[0], where }); return; }
      }
    };
    for (const ing of recipe.ingredients ?? []) {
      scan(normalizeIngName(String(ing?.name ?? "")), "ingredient");
    }
    scan(normText(recipe.name ?? ""), "name");
    for (const step of recipe.steps ?? []) {
      scan(normText(step), "step");
    }
  }
  return hits;
}

// Severe-restriction prompt block injected into every generation prompt.
// Structured week-level terms and per-day note-detected terms are merged;
// violatedTerms (from a failed guard pass) get extra emphasis on retry.
export function avoidPromptBlock(
  avoidTerms: string[],
  noteTerms: string[] = [],
  violatedTerms: string[] = [],
): string {
  const all = mergeTerms(avoidTerms, noteTerms);
  if (!all.length) return "";
  const detail = all.map((t) => {
    const forms = expandAvoidTerm(t).filter((f) => f !== t).slice(0, 12);
    return forms.length ? `${t} (including ${forms.join(", ")})` : t;
  });
  let block = `STRICT AVOID LIST — severe dietary restriction, treat as an allergy. The diners must completely avoid: ${detail.join("; ")}. NEVER include these or anything derived from them in the ingredients, dish name, or steps. This rule overrides every other preference in this prompt.`;
  const violated = mergeTerms(violatedTerms);
  if (violated.length) {
    block += `\nYOUR PREVIOUS ATTEMPT VIOLATED THIS RULE by including: ${violated.join(", ")}. Generate a completely different dish containing absolutely no ${violated.join(", ")} in any form.`;
  }
  return block;
}
