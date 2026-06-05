// TER-336: Admin backfill — deactivate hard-invalid recipe_library rows via the validator.
import { createClient } from "@supabase/supabase-js";
import { getAuthedUser } from "./_admin.js";
import { validateRecipe } from "./_validateRecipe.js";

const PAGE_SIZE = 500;
const BATCH_SIZE = 200;

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const auth = await getAuthedUser(req);
  if (!auth) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!auth.isAdmin) { res.status(403).json({ error: "Forbidden" }); return; }

  let body: any;
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { res.status(400).json({ error: "Invalid JSON" }); return; }

  const dryRun: boolean = body?.dryRun === true;

  const url = process.env.VITE_SUPABASE_URL!;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const svc = createClient(url, svcKey);

  try {
    let scanned = 0;
    let offset = 0;
    const failingIds: string[] = [];
    const failingRows: Array<{ recipe_json: any; hardFailures: string[]; softFailures: string[] }> = [];
    const byRule: Record<string, number> = {};

    while (true) {
      const { data: rows, error } = await svc
        .from("recipe_library")
        .select("id, recipe_json, name, cuisine, servings, nutrition, ingredients, steps")
        .eq("active", true)
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) throw error;
      if (!rows || rows.length === 0) break;

      scanned += rows.length;

      for (const row of rows) {
        let recipe: any;
        if (row.recipe_json && typeof row.recipe_json === "object" && !Array.isArray(row.recipe_json)) {
          recipe = row.recipe_json;
        } else {
          recipe = {
            name: row.name,
            cuisine: row.cuisine,
            servings: row.servings,
            estKcalPerServing: (row.nutrition as any)?.kcalPerServing ?? undefined,
            ingredients: row.ingredients,
            steps: row.steps,
          };
        }

        const result = validateRecipe(recipe);
        if (!result.ok) {
          failingIds.push(row.id);
          failingRows.push({
            recipe_json: row.recipe_json ?? recipe,
            hardFailures: result.hardFailures,
            softFailures: result.softFailures,
          });

          for (const failure of result.hardFailures) {
            const code = failure.split(":")[0];
            byRule[code] = (byRule[code] ?? 0) + 1;
          }
        }
      }

      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    if (!dryRun && failingIds.length > 0) {
      for (let i = 0; i < failingIds.length; i += BATCH_SIZE) {
        const batch = failingIds.slice(i, i + BATCH_SIZE);
        await svc.from("recipe_library").update({ active: false }).in("id", batch);
      }

      try {
        const logRows = failingRows.map((r) => ({
          recipe_json:   r.recipe_json,
          hard_failures: r.hardFailures,
          soft_failures: r.softFailures,
          source:        "backfill",
        }));
        for (let i = 0; i < logRows.length; i += BATCH_SIZE) {
          await svc.from("recipe_validation_failures").insert(logRows.slice(i, i + BATCH_SIZE));
        }
      } catch (logErr: any) {
        console.error("recipe_validation_failures backfill insert failed:", logErr?.message);
      }
    }

    res.status(200).json({
      ok: true,
      dryRun,
      scanned,
      deactivated: failingIds.length,
      byRule,
    });
  } catch (err: any) {
    console.error("admin-recipe-backfill error:", err?.message);
    res.status(500).json({ error: "Internal server error" });
  }
}
