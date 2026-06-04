-- TER-302: Per-user LLM usage logging for cost monitoring and free-tier quota.
-- Apply manually in the Supabase SQL editor (not run by the Supabase CLI in this project).

CREATE TABLE llm_usage (
  id              bigserial PRIMARY KEY,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  model           text,
  input_tokens    int,
  output_tokens   int,
  cache_read_tokens int,
  cost_usd        numeric(10,5),
  feature         text        NOT NULL DEFAULT 'meal_gen'
);

ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;

-- Service-role inserts bypass RLS — no anon insert policy is intentional.
-- Regular users can read their own rows (dashboard / future quota display).
CREATE POLICY "users can read own usage" ON llm_usage
  FOR SELECT USING (user_id = auth.uid());

CREATE INDEX idx_llm_usage_user_created ON llm_usage (user_id, created_at);

-- ── Reporting view ────────────────────────────────────────────────────────────
-- Daily per-user aggregates; consumed by the read-only BI role below.
CREATE VIEW llm_usage_daily AS
SELECT
  user_id,
  created_at::date AS day,
  COUNT(*)::bigint  AS gen_count,
  SUM(cost_usd)     AS total_cost_usd
FROM llm_usage
GROUP BY user_id, created_at::date;

-- ── Read-only BI role (Looker Studio / other BI tool) ─────────────────────────
-- Chris wires the actual BI database connection separately.
-- NEVER use the service-role key for the BI connection.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reporting_ro') THEN
    CREATE ROLE reporting_ro NOLOGIN;
  END IF;
END
$$;

GRANT SELECT ON llm_usage_daily TO reporting_ro;
GRANT SELECT ON llm_usage        TO reporting_ro;
