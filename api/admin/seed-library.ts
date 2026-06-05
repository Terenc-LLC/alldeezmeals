// TER-358: Admin endpoint — seed recipe_library by driving the generation pipeline.
// Accepts two modes: "targets" (list of cuisine+dish pairs) or "named" (a single recipe name).
// All seeded recipes: servings=4, review_status="pending", active=false.
import { createHash } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { getAuthedUser } from "../_admin.js";
import { validateRecipe } from "../_validateRecipe.js";

const SEED_MODEL = "claude-sonnet-4-6";
const SEED_SERVINGS = 4;
const MAX_BATCH = 20;

function normalizeRecipeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function computeContentHash(name: string, ingredients: any[], steps: any[]): string {
  const normedName = normalizeRecipeName(name);
  const ingNames = ingredients
    .map((i: any) => normalizeRecipeName(String(i.name || "")))
    .filter(Boolean).sort().join(",");
  const stepsStr = steps.map((s: any) => String(s || "").trim()).join("|");
  return createHash("sha256").update(`${normedName}|${ingNames}|${stepsStr}`).digest("hex");
}

function buildSeedPrompt(dish: string, cuisine: string): string {
  return `You are a recipe writer for a home-cooking app. Write a completely ORIGINAL recipe for "${dish}" (${cuisine} cuisine).

CRITICAL ORIGINALITY RULE: Write your own cooking directions, descriptions, and method from scratch. Do not reproduce wording or technique from any specific cookbook, website, or source. Naming a dish is not copying — write your own version.

Return ONLY a valid JSON object (no markdown code fences, no commentary) with exactly these fields:
{
  "name": "<full recipe name>",
  "cuisine": "${cuisine}",
  "description": "<1–2 sentence original description>",
  "difficulty": <integer 1–5>,
  "servings": ${SEED_SERVINGS},
  "estKcalPerServing": <integer 150–1500>,
  "ingredients": [
    { "name": "<ingredient>", "qty": <positive number>, "unit": "<unit>", "source": "buy" }
  ],
  "steps": [
    "<complete cooking instruction — at least 20 characters>"
  ]
}

Requirements:
- Minimum 5 ingredients; each must have name, positive qty, and unit
- Minimum 5 steps; each must be a complete cooking instruction (20+ characters)
- Every ingredient mentioned in steps must appear in the ingredients list
- Realistic kcal estimate (150–1500 per serving)
- Use straightforward, commonly-available ingredients`;
}

function buildNamedSeedPrompt(recipeName: string): string {
  return `You are a recipe writer for a home-cooking app. Write a completely ORIGINAL recipe for "${recipeName}".

CRITICAL ORIGINALITY RULE: Write your own cooking directions, descriptions, and method from scratch. Do not reproduce wording or technique from any specific cookbook, website, or source. Naming a dish is not copying — write your own version. Infer the most appropriate cuisine from the dish name.

Return ONLY a valid JSON object (no markdown code fences, no commentary) with exactly these fields:
{
  "name": "<full recipe name>",
  "cuisine": "<inferred cuisine>",
  "description": "<1–2 sentence original description>",
  "difficulty": <integer 1–5>,
  "servings": ${SEED_SERVINGS},
  "estKcalPerServing": <integer 150–1500>,
  "ingredients": [
    { "name": "<ingredient>", "qty": <positive number>, "unit": "<unit>", "source": "buy" }
  ],
  "steps": [
    "<complete cooking instruction — at least 20 characters>"
  ]
}

Requirements:
- Minimum 5 ingredients; each must have name, positive qty, and unit
- Minimum 5 steps; each must be a complete cooking instruction (20+ characters)
- Every ingredient mentioned in steps must appear in the ingredients list
- Realistic kcal estimate (150–1500 per serving)
- Use straightforward, commonly-available ingredients`;
}

async function callClaude(prompt: string, apiKey: string): Promise<{ recipe: any; usage: any } | null> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: SEED_MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await r.json();
  if (!r.ok) return null;
  const text: string = data.content?.[0]?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return { recipe: JSON.parse(match[0]), usage: data.usage ?? null };
  } catch {
    return null;
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const auth = await getAuthedUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!auth.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(500).json({ error: "Server missing ANTHROPIC_API_KEY" }); return; }

  const supabaseUrl = process.env.VITE_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!supabaseUrl || !serviceRoleKey) { res.status(500).json({ error: "Server misconfiguration" }); return; }

  let body: any;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    res.status(400).json({ error: "Invalid JSON" }); return;
  }

  const { mode } = body;
  type SeedItem = { prompt: string; label: string };
  let items: SeedItem[] = [];

  if (mode === "targets") {
    const targets: Array<{ cuisine: string; dish: string }> = Array.isArray(body.targets) ? body.targets : [];
    if (targets.length === 0) { res.status(400).json({ error: "targets array is empty" }); return; }
    const count = Math.min(Math.max(Number(body.count) || targets.length, 1), MAX_BATCH);
    items = targets.slice(0, count).map(t => ({
      prompt: buildSeedPrompt(String(t.dish ?? "").trim(), String(t.cuisine ?? "").trim()),
      label: `${t.cuisine} — ${t.dish}`,
    }));
  } else if (mode === "named") {
    const name = String(body.name ?? "").trim();
    if (!name) { res.status(400).json({ error: "name required for mode=named" }); return; }
    items = [{ prompt: buildNamedSeedPrompt(name), label: name }];
  } else {
    res.status(400).json({ error: "mode must be 'targets' or 'named'" }); return;
  }

  if (items.length === 0) { res.status(400).json({ error: "No items to generate" }); return; }

  const svc = createClient(supabaseUrl, serviceRoleKey);
  const results: Array<{ label: string; saved: boolean; reason?: string }> = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const item of items) {
    try {
      const gen = await callClaude(item.prompt, apiKey);
      if (!gen) {
        results.push({ label: item.label, saved: false, reason: "generation_failed" });
        continue;
      }
      const { recipe, usage } = gen;
      if (usage) {
        totalInputTokens  += usage.input_tokens  ?? 0;
        totalOutputTokens += usage.output_tokens ?? 0;
      }

      recipe.servings = SEED_SERVINGS; // enforce canonical headcount

      const validation = validateRecipe(recipe);

      if (validation.hardFailures.length > 0 || validation.softFailures.length > 0) {
        void (async () => {
          try {
            await svc.from("recipe_validation_failures").insert({
              recipe_json:   recipe,
              hard_failures: validation.hardFailures,
              soft_failures: validation.softFailures,
              source:        "seed",
            });
          } catch { /* swallow */ }
        })();
      }

      if (!validation.ok) {
        results.push({ label: item.label, saved: false, reason: `hard:${validation.hardFailures[0] ?? "unknown"}` });
        continue;
      }
      if (validation.softFailures.length > 0) {
        results.push({ label: item.label, saved: false, reason: `soft:${validation.softFailures[0] ?? "unknown"}` });
        continue;
      }

      const contentHash = computeContentHash(recipe.name, recipe.ingredients, recipe.steps);
      const normalizedRecipe =
        `${normalizeRecipeName(String(recipe.name))}|${String(recipe.cuisine ?? "").toLowerCase().trim()}`;

      const { error: upsertErr } = await svc.from("recipe_library").upsert(
        {
          content_hash:      contentHash,
          normalized_recipe: normalizedRecipe,
          name:              String(recipe.name).trim(),
          cuisine:           recipe.cuisine ? String(recipe.cuisine).trim() : null,
          dietary_tags:      [],
          ingredients:       recipe.ingredients,
          steps:             recipe.steps,
          nutrition:         recipe.estKcalPerServing ? { kcalPerServing: recipe.estKcalPerServing } : null,
          difficulty:        typeof recipe.difficulty === "number" ? recipe.difficulty : null,
          servings:          SEED_SERVINGS,
          base_recipe_id:    null,
          times_reused:      0,
          active:            false,
          review_status:     "pending",
          source:            "generated",
          model:             SEED_MODEL,
          recipe_json:       recipe,
        },
        { onConflict: "content_hash", ignoreDuplicates: true },
      );

      if (upsertErr) {
        results.push({ label: item.label, saved: false, reason: "db_error" });
      } else {
        results.push({ label: item.label, saved: true });
      }
    } catch (e: any) {
      results.push({ label: item.label, saved: false, reason: String(e?.message ?? "error") });
    }
  }

  // Best-effort aggregate usage log
  try {
    if (totalInputTokens > 0 || totalOutputTokens > 0) {
      const costUsd = (totalInputTokens * 3 + totalOutputTokens * 15) / 1_000_000;
      await svc.from("llm_usage").insert({
        user_id:      auth.user.id,
        model:        SEED_MODEL,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        cache_read_tokens: 0,
        cost_usd:     costUsd,
        feature:      "seed_library",
      });
    }
  } catch { /* swallow — logging must not change the response */ }

  const saved   = results.filter(r => r.saved).length;
  const skipped = results.filter(r => r.reason?.startsWith("soft")).length;
  const failed  = results.filter(r => !r.saved && !r.reason?.startsWith("soft")).length;

  res.status(200).json({ ok: true, results, generated: items.length, saved, skipped, failed });
}
