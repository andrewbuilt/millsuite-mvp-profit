-- ============================================================================
-- 044 — Parse-call log + per-org daily parse cap
-- ============================================================================
-- Tracks every call to /api/parse-drawings so we can rate-limit at the
-- org level. V1 hardcodes the cap default at 50 across all plans — V2
-- will read the cap from a plan-tier table or stripe metadata. Until
-- then, a per-org override is one column update away.
--
-- Failed calls don't count against the cap (operators shouldn't be
-- penalized for our retry logic), but we still log them so we can
-- spot upstream issues. Rate-limited calls DO count — once you've
-- hit the limit, every additional attempt logs a 'rate_limited' row
-- so the daily count stays consistent with what the user sees.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.parse_call_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL,
  user_id        uuid NULL,
  file_name      text NOT NULL,
  call_date      date NOT NULL DEFAULT CURRENT_DATE,
  status         text NOT NULL CHECK (status IN ('success','failed','rate_limited')),
  error_message  text NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_parse_log_org_date
  ON public.parse_call_log(org_id, call_date);

ALTER TABLE public.parse_call_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parse_call_log_select ON public.parse_call_log;
DROP POLICY IF EXISTS parse_call_log_insert ON public.parse_call_log;

CREATE POLICY parse_call_log_select ON public.parse_call_log FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.org_id = parse_call_log.org_id AND u.auth_user_id = auth.uid()
  ));
CREATE POLICY parse_call_log_insert ON public.parse_call_log FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.org_id = parse_call_log.org_id AND u.auth_user_id = auth.uid()
  ));

-- Plan-tier cap defaults. V1 hardcodes 50 for all orgs; V2 reads from
-- a plan-tier table or stripe subscription metadata.
ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS daily_parse_cap int NOT NULL DEFAULT 50;

COMMIT;
