// Vercel serverless function. Runs on the server, never shipped to the browser.
// Keeps ANTHROPIC_API_KEY secret. Frontend calls POST /api/generate with { prompt }.

import { createClient } from "@supabase/supabase-js";
import { isApproved } from "./_approved.js";

// ── LLM cost rate table ($/MTok) ─────────────────────────────────────────────
// Update this table when Anthropic changes pricing; cost_usd is frozen at write time.
// cache-read ≈ 0.1× input; cache-write ≈ 1.25× input.
const LLM_RATES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-sonnet-4-6":          { input: 3,  output: 15, cacheRead: 0.30,  cacheWrite: 3.75 },
  "claude-haiku-4-5-20251001":  { input: 1,  output: 5,  cacheRead: 0.10,  cacheWrite: 1.25 },
};

function computeCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number,
): number {
  const rates = LLM_RATES[modelId] ?? LLM_RATES["claude-sonnet-4-6"];
  const perTok = (rate: number) => rate / 1_000_000;
  return (
    inputTokens    * perTok(rates.input)      +
    outputTokens   * perTok(rates.output)     +
    cacheReadTokens  * perTok(rates.cacheRead)  +
    cacheWriteTokens * perTok(rates.cacheWrite)
  );
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.status(500).json({ error: "Server missing ANTHROPIC_API_KEY" });
    return;
  }

  // Validate Supabase session — closes the open-proxy gap left by TER-187 (TER-188).
  const authHeader = (req.headers["authorization"] as string) ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({ error: "Server missing Supabase configuration" });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  // Separate service-role client for usage logging — anon client cannot INSERT (no RLS policy).
  const supabaseService = serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey)
    : null;
  const { data: userData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !userData.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const approved = await isApproved(token, userData.user.id);
  if (!approved) { res.status(403).json({ error: "Account pending approval" }); return; }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const {
      prompt,
      max_tokens = 1000,
      model = "claude-sonnet-4-6", // swap to "claude-haiku-4-5-20251001" to cut cost
    } = body;

    if (!prompt) {
      res.status(400).json({ error: "Missing prompt" });
      return;
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await r.json();
    // Pass Anthropic's status + body through unchanged so the frontend gets the real error.
    if (!r.ok) {
      res.status(r.status).json(data);
      return;
    }

    // Best-effort usage logging — a failure here must never change the 200 response.
    try {
      const usage = data.usage ?? null;
      if (usage && supabaseService) {
        const inputTokens      = usage.input_tokens             ?? 0;
        const outputTokens     = usage.output_tokens            ?? 0;
        const cacheReadTokens  = usage.cache_read_input_tokens  ?? 0;
        const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
        const costUsd = computeCostUsd(model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens);
        await supabaseService.from("llm_usage").insert({
          user_id:           userData.user.id,
          model,
          input_tokens:      inputTokens,
          output_tokens:     outputTokens,
          cache_read_tokens: cacheReadTokens,
          cost_usd:          costUsd,
          feature:           "meal_gen",
        });
      }
    } catch {
      // Intentionally swallowed — logging must not block generation.
    }

    res.status(200).json(data);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
