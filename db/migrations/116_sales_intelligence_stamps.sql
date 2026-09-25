-- ============================================================================
-- 116 — sales intelligence: lost_at / lost_reason / lead_source  (data half)
-- ============================================================================
-- The Sales Intelligence feature (lost archive · lead sources · sales report,
-- scoped 2026-09-23) is built on three stamps. This migration ships AHEAD of
-- the surfaces on purpose: every project lost before `lost_at` exists is
-- report data that can never be recovered, so the stamping starts today and
-- the report gets smarter every month it runs (the scope's honesty rule).
--
--   lost_at     — stamped by lib/sales.updateProjectStage on every transition
--                 INTO 'lost' (the sold_at/094 pattern: first transition only;
--                 re-dragging a lost card never moves the date). Cleared when
--                 a lost project re-enters the pipeline — a revived deal is
--                 not a lost one.
--   lost_reason — optional, typed at the lost-drag prompt (capture UI, next
--                 session). Never blocks the drag.
--   lead_source — a NAME from orgs.lead_sources (managed like task tags:
--                 names are the data, the registry is for the picker).
--
-- Backfill for lost_at: project_events stage rows where they exist (the
-- board logs `stage_change` with meta.stage), else stays null — the report
-- says what window it's computed from rather than inventing dates.
--
-- Idempotent. No RLS change — projects/orgs carry their policies.
-- ============================================================================

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS lost_at timestamptz NULL;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS lost_reason text NULL;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS lead_source text NULL;

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS lead_sources jsonb;

-- Backfill lost_at from the event log where a stage_change into 'lost' was
-- recorded. Latest such event per project; only currently-lost projects, and
-- only where lost_at is still null (re-running never rewrites a stamp).
UPDATE public.projects p
SET lost_at = ev.at
FROM (
  SELECT project_id, MAX(created_at) AS at
  FROM public.project_events
  WHERE event_type = 'stage_change'
    AND meta ->> 'stage' = 'lost'
  GROUP BY project_id
) AS ev
WHERE ev.project_id = p.id
  AND p.stage = 'lost'
  AND p.lost_at IS NULL;

COMMENT ON COLUMN public.projects.lost_at IS
  'First transition into stage=lost (sold_at pattern). Cleared on revival. '
  'Stamped by lib/sales.updateProjectStage. Drives the lost archive + sales '
  'report. See migration 116.';
COMMENT ON COLUMN public.projects.lost_reason IS
  'Optional, typed at the lost-drag prompt. Never blocks the drag. See 116.';
COMMENT ON COLUMN public.projects.lead_source IS
  'Lead source NAME (orgs.lead_sources is the picker registry, task-tags '
  'pattern — renames there do not rewrite projects). See 116.';

COMMIT;

NOTIFY pgrst, 'reload schema';
