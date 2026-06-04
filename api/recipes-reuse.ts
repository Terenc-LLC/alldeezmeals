// TER-317: Recipe library P2a — serve-as-is reuse (zero-LLM) with maturity dial.
// Authenticated, service-role. Mirrors api/recipes.ts auth pattern.

import { createClient } from "@supabase/supabase-js";
import { isApproved } from "./_approved.js";

function normalizeRecipeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function reuseRatio(n: number): number {
  if (n < 10)   return 0;
  if (n < 30)   return 0.25;
  if (n < 1000) return 0.5;
  return 0.8;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const supabaseUrl    = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }

  const authHeader = (req.headers["authorization"] as string) ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const anonClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: userData, error: authError } = await anonClient.auth.getUser(token);
  if (authError || !userData.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const approved = await isApproved(token, userData.user.id);
  if (!approved) { res.status(403).json({ error: "Account pending approval" }); return; }

  try {
    let body: any;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    } catch {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }

    const { people, cuisine, effortMin, effortMax, excludeNames } = body as {
      people: number;
      cuisine: string | null;
      effortMin: number | null;
      effortMax: number | null;
      excludeNames: string[];
    };

    const svc = createClient(supabaseUrl, serviceRoleKey);

    // a. Count reusable originals (active, not a variant, has full payload).
    const { count, error: countErr } = await svc
      .from("recipe_library")
      .select("*", { count: "exact", head: true })
      .eq("active", true)
      .is("base_recipe_id", null)
      .not("recipe_json", "is", null);

    if (countErr) {
      res.status(200).json({ reuse: false });
      return;
    }

    const ratio = reuseRatio(count ?? 0);

    // b. Roll — ratio 0 means never reuse.
    if (Math.random() >= ratio) {
      res.status(200).json({ reuse: false });
      return;
    }

    // c. Candidate query.
    let q = svc
      .from("recipe_library")
      .select("id,name,cuisine,difficulty,servings,times_reused,recipe_json")
      .eq("active", true)
      .is("base_recipe_id", null)
      .not("recipe_json", "is", null)
      .eq("servings", people)
      .order("times_reused", { ascending: true })
      .limit(50);

    if (cuisine) {
      q = q.eq("cuisine", cuisine);
    }
    if (effortMin != null && effortMax != null) {
      q = q.gte("difficulty", effortMin).lte("difficulty", effortMax);
    }

    const { data: candidates, error: candErr } = await q;
    if (candErr || !candidates || candidates.length === 0) {
      res.status(200).json({ reuse: false });
      return;
    }

    // d. Exclude names matching any in excludeNames.
    const normalizedExcludes = (excludeNames ?? []).map(normalizeRecipeName);
    const eligible = candidates.filter(
      (c: any) => !normalizedExcludes.includes(normalizeRecipeName(c.name))
    );
    if (eligible.length === 0) {
      res.status(200).json({ reuse: false });
      return;
    }

    // e. Pick randomly among those tied at minimum times_reused.
    const minReused = eligible[0].times_reused;
    const tied = eligible.filter((c: any) => c.times_reused === minReused);
    const chosen = tied[Math.floor(Math.random() * tied.length)];

    // f. Best-effort increment — never blocks serving.
    svc
      .from("recipe_library")
      .update({ times_reused: chosen.times_reused + 1 })
      .eq("id", chosen.id)
      .then(undefined, () => {});

    // g. Return the full payload.
    res.status(200).json({ reuse: true, recipe: chosen.recipe_json });
  } catch {
    res.status(200).json({ reuse: false });
  }
}
