// TER-514: seed-library prompt + response parsing.
// Duplicated (not imported) from src/lib/recipeGenerate.ts — apps/admin/api
// does not reach across the app boundary into the consumer's src/ (established
// in TER-510; see _validateRecipe.ts, which duplicates the same way).

const CATEGORIES = ["Produce", "Meat & Seafood", "Dairy & Eggs", "Pantry", "Frozen", "Bakery", "Other"];

function recipeOutputContract(servings: number): string {
  return `Each ingredient requires: source ("buy"|"reused"|"staple"), recipeAmount {qty, unit} (cooking amount; required for buy & reused; optional for staple — use qty:0,unit:"to taste" if unmeasured). For source:"buy" only: purchaseSize (realistic ALDI package label, e.g. "1 head", "16 oz box", "2 lb bag", "1 dozen") and purchaseQty (integer ≥ 1, packages rounded UP to cover recipeAmount). For source:"reused" set purchaseSize:"" purchaseQty:0 AND set buySourceName to the EXACT ingredient name used by the meal that buys the raw product (the raw purchasable form, e.g. "boneless skinless chicken breasts") — it must match a buy-item name shown for the other dinners sharing this shopping trip when such a list is provided. For source:"staple" omit or zero purchaseSize/purchaseQty. preparedEarlier (boolean, default false): set to true ONLY if this ingredient was actually prepped/cooked in an EARLIER meal this week and is being reused in that prepared form (e.g. shredded chicken poached Monday, onions diced earlier). A whole/raw item pulled from a shared pack is NOT preparedEarlier (e.g. half an onion from the already-purchased bag → preparedEarlier:false). This field is independent of source.

Respond with ONLY one JSON object -- no markdown, no fences, no commentary. Include numbered step-by-step cooking instructions in "steps". Set realistic "prepMinutes" and "cookMinutes" integers. Set "estKcalPerServing" to your best integer estimate of kilocalories per serving for the given number of servings. Set "estMacrosPerServing" to your best integer estimate of grams of protein, fat, and carbohydrate per serving. Set "difficulty" to an integer 0–5 for total effort: 0=premade/heat-and-serve (no real prep), 1=minimal (assemble/microwave/toast), 2=simple one-pan/weeknight, 3=moderate (some technique or multiple components), 4=involved (multiple steps/timing), 5=intricate (advanced technique or long prep). Use 0–1 for occasional convenience nights. ORIGINALITY: write original recipes — original cooking directions and descriptions in your own words; do not copy text from published recipes. (Quantities/ingredient lists are fine; the written steps/description must be original.) SPECIFIC NAME: set "name" to a distinctive, specific dish name (e.g. "Ginger-Soy Chicken Stir Fry with Peppers"), NOT a generic category ("Chicken Stir Fry"). Exactly:
{"name":"","description":"one short sentence","cuisine":"","servings":${servings},"prepMinutes":0,"cookMinutes":0,"estKcalPerServing":0,"estMacrosPerServing":{"protein_g":0,"fat_g":0,"carbs_g":0},"difficulty":0,"reuseNote":"","provenance":"","reuseNotes":[],"pantryNote":"","ingredients":[{"name":"","recipeAmount":{"qty":0,"unit":""},"source":"buy","preparedEarlier":false,"purchaseSize":"","purchaseQty":1,"buySourceName":"","category":"Produce|Meat & Seafood|Dairy & Eggs|Pantry|Frozen|Bakery|Other"}],"steps":["step 1","step 2","..."]}`;
}

export function buildSeedPrompt(target: string, servings = 4): string {
  return `You are creating ONE original dinner recipe for a family that shops at ALDI. Dish to create: ${target}. Use mainstream, affordable ALDI ingredients; include EVERY ingredient (mains, reused, staples) each with a "source". Write an ORIGINAL recipe — original steps and wording in your own words; do NOT reproduce any specific published recipe. Set "name" to a specific, distinctive dish name.

` + recipeOutputContract(servings);
}

// Mirrors the shape-normalization in generateRecipeFromPrompt (src/lib/recipeGenerate.ts).
export function parseRecipeResponse(text: string): any {
  const obj = JSON.parse(text.replace(/```json/gi, "").replace(/```/g, "").trim());
  if (!obj.name || !Array.isArray(obj.ingredients)) throw new Error("bad shape");
  obj.prepMinutes = typeof obj.prepMinutes === "number" ? Math.round(obj.prepMinutes) : null;
  obj.cookMinutes = typeof obj.cookMinutes === "number" ? Math.round(obj.cookMinutes) : null;
  obj.estKcalPerServing = typeof obj.estKcalPerServing === "number" && obj.estKcalPerServing > 0 ? Math.round(obj.estKcalPerServing) : null;
  {
    const em = obj.estMacrosPerServing;
    const p = Number(em?.protein_g), f = Number(em?.fat_g), c = Number(em?.carbs_g);
    obj.estMacrosPerServing =
      em && typeof em === "object" && [p, f, c].every((x) => Number.isFinite(x) && x > 0)
        ? { protein_g: Math.round(p), fat_g: Math.round(f), carbs_g: Math.round(c) }
        : null;
  }
  obj.difficulty = typeof obj.difficulty === "number"
    ? Math.min(5, Math.max(0, Math.round(obj.difficulty)))
    : null;
  obj.steps = Array.isArray(obj.steps) ? obj.steps.map(String).filter(Boolean) : [];
  obj.ingredients = obj.ingredients.map((i: any) => {
    const name = String(i.name || "").trim();
    const category = CATEGORIES.includes(i.category) ? i.category : "Other";
    const recipeAmount = (i.recipeAmount && typeof i.recipeAmount === "object")
      ? { qty: Number(i.recipeAmount.qty) || 0, unit: String(i.recipeAmount.unit || "").trim() }
      : { qty: Number(i.qty) || 0, unit: String(i.unit || "").trim() };
    let purchaseSize: string;
    let purchaseQty: number;
    if (i.purchaseSize && i.purchaseQty != null) {
      purchaseSize = String(i.purchaseSize).trim();
      purchaseQty = Math.max(1, Math.ceil(Number(i.purchaseQty) || 0));
    } else {
      purchaseSize = recipeAmount.unit
        ? `${recipeAmount.qty} ${recipeAmount.unit}`.trim()
        : String(recipeAmount.qty);
      purchaseQty = 1;
    }
    const source: "buy" | "reused" | "staple" =
      i.source === "reused" ? "reused" : i.source === "staple" ? "staple" : "buy";
    const preparedEarlier: boolean = i.preparedEarlier === true;
    const out: any = { name, recipeAmount, purchaseSize, purchaseQty, category, source, preparedEarlier };
    if (source === "reused") {
      const buySourceName = String(i.buySourceName || "").trim();
      if (buySourceName) out.buySourceName = buySourceName;
    }
    return out;
  }).filter((i: any) => i.name);
  obj.provenance = typeof obj.provenance === "string" ? obj.provenance : "";
  obj.reuseNotes = Array.isArray(obj.reuseNotes) ? obj.reuseNotes.filter((s: any) => typeof s === "string") : [];
  obj.pantryNote = typeof obj.pantryNote === "string" ? obj.pantryNote : "";
  return obj;
}

export function normalizeRecipeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
