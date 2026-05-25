// Vercel serverless function. Runs on the server, never shipped to the browser.
// Keeps ANTHROPIC_API_KEY secret. Frontend calls POST /api/generate with { prompt }.

import { createClient } from "@supabase/supabase-js";

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
  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({ error: "Server missing Supabase configuration" });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: userData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !userData.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

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
    res.status(200).json(data);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
