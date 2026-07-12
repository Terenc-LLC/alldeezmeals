// TER-358/TER-514: admin seed-library — generate one original recipe for a
// dish target and land it pending in recipe_library. Self-contained (calls
// Anthropic directly + writes via service role) so it never needs a
// cross-origin call into the consumer app's /api/generate or /api/recipes —
// apps/admin is a separate Vercel project (TER-510).
import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { getAuthedUser } from "./_admin.js";
import { validateRecipe } from "./_validateRecipe.js";
import { buildSeedPrompt, parseRecipeResponse, normalizeRecipeName } from "./_recipeGen.js";

const MODEL = "claude-sonnet-4-6";

function computeContentHash(name: string, ingredients: any[], steps: any[]): string {
  const normalizedName = normalizeRecipeName(name);
  const ingNames = ingredients
    .map((i: any) => normalizeRecipeName(String(i.name || "")))
    .filter(Boolean)
    .sort()
    .join(",");
  const stepsStr = steps.map((s: any) => String(s || "").trim()).join("|");
  return createHash("sha256")
    .update(`${normalizedName}|${ingNames}|${stepsStr}`)
    .digest("hex");
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const auth = await getAuthedUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!auth.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }

  let body: any;
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { res.status(400).json({ error: "Invalid JSON" }); return; }

  const target = typeof body?.target === "string" ? body.target.trim() : "";
  const servings = Number.isFinite(body?.servings) ? Math.max(1, Math.round(body.servings)) : 4;
  if (!target) { res.status(400).json({ error: "target required" }); return; }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) { res.status(500).json({ error: "Server missing ANTHROPIC_API_KEY" }); return; }

  const url = process.env.VITE_SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const svc = createClient(url, svcKey);

  const prompt = buildSeedPrompt(target, servings);
  let recipe: any = null;
  let lastErr: any = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model: MODEL, max_tokens: 5000, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await r.json();
      if (!r.ok) {
        const msg = data?.error?.message ?? data?.error ?? `Anthropic error ${r.status}`;
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      if (data.stop_reason === "max_tokens") {
        throw Object.assign(new Error("Response truncated by token limit"), { truncated: true });
      }
      const text = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
      recipe = parseRecipeResponse(text);
      break;
    } catch (e: any) {
      lastErr = e;
      const retryable = e?.truncated || e instanceof SyntaxError || e?.message === "bad shape";
      if (!retryable || attempt === 2) break;
    }
  }

  if (!recipe) {
    res.status(502).json({ ok: false, target, reason: lastErr?.message ?? "Generation failed" });
    return;
  }

  const { name, cuisine, servings: gotServings, difficulty, estKcalPerServing, steps, ingredients } = recipe;
  const validation = validateRecipe(recipe);

  if (validation.hardFailures.length > 0 || validation.softFailures.length > 0) {
    try {
      await svc.from("recipe_validation_failures").insert({
        recipe_json:   recipe,
        hard_failures: validation.hardFailures,
        soft_failures: validation.softFailures,
        source:        "seed",
      });
    } catch (logErr: any) {
      console.error("recipe_validation_failures insert failed:", logErr?.message);
    }
  }

  if (!validation.ok) {
    res.status(422).json({ ok: false, target, hardFailures: validation.hardFailures });
    return;
  }

  if (validation.softFailures.length > 0) {
    res.status(200).json({ ok: true, target, saved: false, softFailures: validation.softFailures });
    return;
  }

  const contentHash = computeContentHash(name, ingredients, steps);
  const normalizedRecipe = `${normalizeRecipeName(name)}|${(cuisine ?? "").toLowerCase().trim()}`;

  const { error } = await svc.from("recipe_library").upsert(
    {
      content_hash:      contentHash,
      normalized_recipe: normalizedRecipe,
      name:              String(name).trim(),
      cuisine:           cuisine ? String(cuisine).trim() : null,
      dietary_tags:      [],
      ingredients,
      steps,
      nutrition:         estKcalPerServing ? { kcalPerServing: estKcalPerServing } : null,
      difficulty:        typeof difficulty === "number" ? difficulty : null,
      servings:          typeof gotServings === "number" ? gotServings : servings,
      base_recipe_id:    null,
      times_reused:      0,
      active:            false,
      review_status:     "pending",
      source:            "generated",
      model:             MODEL,
      recipe_json:       recipe,
    },
    { onConflict: "content_hash", ignoreDuplicates: true },
  );

  if (error) {
    console.error("recipe_library upsert failed:", error.message);
    res.status(500).json({ error: "Failed to save recipe" });
    return;
  }

  res.status(200).json({ ok: true, target, saved: true });
}
