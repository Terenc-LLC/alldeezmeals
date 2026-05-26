import { describe, it, expect } from "vitest";
import { normalizeUnit, buildInstacartHandoff, INSTACART_PREAMBLE } from "./instacart-handoff";

describe("normalizeUnit", () => {
  // Rule 1: countable produce → each
  it("yellow onion → each", () => {
    const r = normalizeUnit("each", 3, "Yellow onion");
    expect(r.unit).toBe("each");
    expect(r.qty).toBe(3);
    expect(r.textDisplay).toBe("3 each");
  });

  it("lemon (countable produce) → each", () => {
    const r = normalizeUnit("1 each", 2, "Lemon");
    expect(r.unit).toBe("each");
    expect(r.qty).toBe(2);
  });

  it("avocado → each", () => {
    const r = normalizeUnit("each", 4, "Avocado");
    expect(r.unit).toBe("each");
    expect(r.qty).toBe(4);
  });

  // Rule 2: leafy heads → head
  it("romaine lettuce → head", () => {
    const r = normalizeUnit("1 head", 1, "Romaine lettuce");
    expect(r.unit).toBe("head");
    expect(r.qty).toBe(1);
    expect(r.textDisplay).toBe("1 head");
  });

  it("green cabbage → head", () => {
    const r = normalizeUnit("head", 1, "Green cabbage");
    expect(r.unit).toBe("head");
    expect(r.qty).toBe(1);
  });

  // Rule 3: eggs → dozen / "large"
  it("large eggs (1 carton) → large, qty=12", () => {
    const r = normalizeUnit("1 dozen", 1, "Large eggs");
    expect(r.unit).toBe("large");
    expect(r.qty).toBe(12);
    expect(r.textDisplay).toBe("1 dozen");
  });

  it("eggs (2 cartons) → large, qty=24, '2 dozen'", () => {
    const r = normalizeUnit("1 dozen", 2, "Large eggs");
    expect(r.unit).toBe("large");
    expect(r.qty).toBe(24);
    expect(r.textDisplay).toBe("2 dozen");
  });

  // Rule 4: supported compound container unit
  it("'14.5 oz can' → oz can", () => {
    const r = normalizeUnit("14.5 oz can", 2, "Diced tomatoes");
    expect(r.unit).toBe("oz can");
    expect(r.qty).toBe(2);
    expect(r.textDisplay).toBe("2 × 14.5 oz can");
  });

  it("'32 fl oz container' → fl oz container", () => {
    const r = normalizeUnit("32 fl oz container", 1, "Chicken broth");
    expect(r.unit).toBe("fl oz container");
    expect(r.qty).toBe(1);
  });

  it("'2 lb bag' → lb bag", () => {
    const r = normalizeUnit("2 lb bag", 1, "Shredded mozzarella");
    expect(r.unit).toBe("lb bag");
    expect(r.qty).toBe(1);
  });

  it("'16 fl oz jar' → fl oz jar", () => {
    const r = normalizeUnit("16 fl oz jar", 1, "Pasta sauce");
    expect(r.unit).toBe("fl oz jar");
    expect(r.qty).toBe(1);
  });

  // Rule 5: unsupported container word → package
  it("'16 oz box' → package", () => {
    const r = normalizeUnit("16 oz box", 1, "Honey Nut Cheerios");
    expect(r.unit).toBe("package");
    expect(r.qty).toBe(1);
    expect(r.textDisplay).toBe("1 × 16 oz box");
  });

  it("'12 oz box' → package", () => {
    const r = normalizeUnit("12 oz box", 1, "Pasta");
    expect(r.unit).toBe("package");
  });

  // Rule 6: bare weight string
  it("'2 lb' (ground beef) → lb, qty=2", () => {
    const r = normalizeUnit("2 lb", 1, "Ground beef");
    expect(r.unit).toBe("lb");
    expect(r.qty).toBe(2);
    expect(r.textDisplay).toBe("2 lb");
  });

  it("'16 oz' (cream cheese) → oz, qty=16", () => {
    const r = normalizeUnit("16 oz", 1, "Cream cheese");
    expect(r.unit).toBe("oz");
    expect(r.qty).toBe(16);
  });

  // Rule 7: unsupported unit fallback → package
  it("'1/2 gal' → package (unsupported compound)", () => {
    const r = normalizeUnit("1/2 gal", 1, "Plain oat milk");
    expect(r.unit).toBe("package");
    expect(r.qty).toBe(1);
  });

  it("'loaf' → package (unknown countable)", () => {
    const r = normalizeUnit("loaf", 2, "Whole wheat bread");
    expect(r.unit).toBe("package");
    expect(r.qty).toBe(2);
  });

  // Direct supported unit pass-through
  it("'lb' alone (staple, butter) → lb", () => {
    const r = normalizeUnit("lb", 1, "Salted butter");
    expect(r.unit).toBe("lb");
    expect(r.qty).toBe(1);
  });

  // New alias/plural forms
  it("'cups' → cups (plural alias)", () => {
    const r = normalizeUnit("cups", 2, "Water");
    expect(r.unit).toBe("cups");
    expect(r.qty).toBe(2);
    expect(r.textDisplay).toBe("2 cups");
  });

  it("'gallons' → gallons (plural alias)", () => {
    const r = normalizeUnit("gallons", 1, "Whole milk");
    expect(r.unit).toBe("gallons");
    expect(r.qty).toBe(1);
  });

  it("'liters' → liters (plural alias)", () => {
    const r = normalizeUnit("liters", 2, "Sparkling water");
    expect(r.unit).toBe("liters");
    expect(r.qty).toBe(2);
  });

  it("'litre' → litre (British spelling)", () => {
    const r = normalizeUnit("litre", 1, "Olive oil");
    expect(r.unit).toBe("litre");
    expect(r.qty).toBe(1);
  });

  it("'teaspoons' → teaspoons (plural alias)", () => {
    const r = normalizeUnit("teaspoons", 2, "Salt");
    expect(r.unit).toBe("teaspoons");
    expect(r.qty).toBe(2);
  });

  it("'tablespoons' → tablespoons (plural alias)", () => {
    const r = normalizeUnit("tablespoons", 3, "Olive oil");
    expect(r.unit).toBe("tablespoons");
    expect(r.qty).toBe(3);
  });

  it("'ts' → ts (teaspoon alias)", () => {
    const r = normalizeUnit("ts", 1, "Vanilla extract");
    expect(r.unit).toBe("ts");
    expect(r.qty).toBe(1);
  });

  it("'tspn' → tspn (teaspoon alias)", () => {
    const r = normalizeUnit("tspn", 1, "Baking powder");
    expect(r.unit).toBe("tspn");
    expect(r.qty).toBe(1);
  });

  it("'tbsp' → tbsp (tablespoon alias)", () => {
    const r = normalizeUnit("tbsp", 2, "Butter");
    expect(r.unit).toBe("tbsp");
    expect(r.qty).toBe(2);
  });

  it("'tbspn' → tbspn (tablespoon alias)", () => {
    const r = normalizeUnit("tbspn", 1, "Honey");
    expect(r.unit).toBe("tbspn");
    expect(r.qty).toBe(1);
  });

  it("'pints' → pints (plural alias)", () => {
    const r = normalizeUnit("pints", 2, "Heavy cream");
    expect(r.unit).toBe("pints");
    expect(r.qty).toBe(2);
  });

  it("'quarts' → quarts (plural alias)", () => {
    const r = normalizeUnit("quarts", 1, "Chicken broth");
    expect(r.unit).toBe("quarts");
    expect(r.qty).toBe(1);
  });
});

describe("buildInstacartHandoff", () => {
  it("returns preamble and lines", () => {
    const list = {
      Produce: [{ name: "Yellow onion", qty: 3, unit: "each" }],
      "Meat & Seafood": [],
      "Dairy & Eggs": [],
      Pantry: [],
      Frozen: [],
      Bakery: [],
      Other: [],
    };
    const result = buildInstacartHandoff(list, []);
    expect(result.preamble).toBe(INSTACART_PREAMBLE);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toBe("- Yellow onion — 3 each");
    expect(result.lineItems[0].unit).toBe("each");
  });

  it("attaches valid UPC from catalog", () => {
    const list = {
      Pantry: [{ name: "Diced tomatoes", qty: 2, unit: "14.5 oz can" }],
      Produce: [], "Meat & Seafood": [], "Dairy & Eggs": [], Frozen: [], Bakery: [], Other: [],
    };
    const catalog = [{ normalized_name: "diced tomatoes", upc: "041303001738" }];
    const result = buildInstacartHandoff(list, catalog);
    expect(result.lines[0]).toContain("[UPC 041303001738]");
    expect(result.lineItems[0].upc).toBe("041303001738");
  });

  it("omits malformed UPC (wrong digit count)", () => {
    const list = {
      Pantry: [{ name: "Black beans", qty: 1, unit: "15 oz can" }],
      Produce: [], "Meat & Seafood": [], "Dairy & Eggs": [], Frozen: [], Bakery: [], Other: [],
    };
    const catalog = [{ normalized_name: "black beans", upc: "123" }]; // malformed
    const result = buildInstacartHandoff(list, catalog);
    expect(result.lines[0]).not.toContain("[UPC");
    expect(result.lineItems[0].upc).toBeUndefined();
  });

  it("excludes zero-qty items", () => {
    const list = {
      Pantry: [{ name: "Olive oil", qty: 0, unit: "16 fl oz" }],
      Produce: [], "Meat & Seafood": [], "Dairy & Eggs": [], Frozen: [], Bakery: [], Other: [],
    };
    const result = buildInstacartHandoff(list, []);
    expect(result.lines).toHaveLength(0);
  });

  it("lineItem.display_text is '{name} ({size})' for packaged item", () => {
    const list = {
      Pantry: [{ name: "Diced tomatoes", qty: 2, unit: "14.5 oz can" }],
      Produce: [], "Meat & Seafood": [], "Dairy & Eggs": [], Frozen: [], Bakery: [], Other: [],
    };
    const result = buildInstacartHandoff(list, []);
    expect(result.lineItems[0].display_text).toBe("Diced tomatoes (14.5 oz can)");
    // text path is unchanged
    expect(result.lines[0]).toBe("- Diced tomatoes — 2 × 14.5 oz can");
  });

  it("lineItem.display_text includes size for produce", () => {
    const list = {
      Produce: [{ name: "Yellow onion", qty: 3, unit: "each" }],
      "Meat & Seafood": [], "Dairy & Eggs": [], Pantry: [], Frozen: [], Bakery: [], Other: [],
    };
    const result = buildInstacartHandoff(list, []);
    expect(result.lineItems[0].display_text).toBe("Yellow onion (each)");
    // text path is unchanged
    expect(result.lines[0]).toBe("- Yellow onion — 3 each");
  });

  it("de-duplicates UPCs across line items", () => {
    const list = {
      Pantry: [
        { name: "Item A", qty: 1, unit: "14 oz can" },
        { name: "Item B", qty: 1, unit: "14 oz can" },
      ],
      Produce: [], "Meat & Seafood": [], "Dairy & Eggs": [], Frozen: [], Bakery: [], Other: [],
    };
    const catalog = [
      { normalized_name: "item a", upc: "012345678901" },
      { normalized_name: "item b", upc: "012345678901" }, // same UPC
    ];
    const result = buildInstacartHandoff(list, catalog);
    const upcLines = result.lines.filter((l) => l.includes("[UPC"));
    expect(upcLines).toHaveLength(1); // only first gets the UPC
  });
});
