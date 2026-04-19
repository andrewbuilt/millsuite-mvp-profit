-- ============================================================================
-- Migration 004 — projects.stage (sales pipeline) + drop legacy leads tables
-- ============================================================================
-- Replaces the Apr 18 leads scaffold. Per BUILD-PLAN.md Phase 5 + STATE.md:
--   Leads are projects with a stage field, NOT a separate entity. The five
--   sales stages (new_lead → fifty_fifty → ninety_percent → sold → lost) now
--   live on projects.stage. Drag-in-Kanban updates the stage; "Sold" also
--   flips status to 'active' so the project enters the in-shop lifecycle.
--
-- `projects.status` is unchanged and continues to mean in-shop lifecycle
-- ('bidding' | 'active' | 'completed'). `projects.stage` is the sales
-- pipeline position.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

-- 1. Add projects.stage with a CHECK constraint mirroring the mockup stages.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'new_lead'
    CHECK (stage IN ('new_lead', 'fifty_fifty', 'ninety_percent', 'sold', 'lost'));

CREATE INDEX IF NOT EXISTS idx_projects_org_stage ON projects(org_id, stage);

-- 2. Backfill stage from legacy data:
--    - projects that came from a lead (source_lead_id NOT NULL) → carry the
--      lead's status across.
--    - projects with status='active'|'completed' that predate leads → 'sold'.
--    - projects with status='bidding' that aren't lead-sourced → 'new_lead'.
--    - projects with status='cancelled' → 'lost'.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leads') THEN
    UPDATE projects p
       SET stage = l.status
      FROM leads l
     WHERE p.source_lead_id = l.id
       AND l.status IN ('new_lead', 'fifty_fifty', 'ninety_percent', 'sold', 'lost');
  END IF;
END $$;

UPDATE projects
   SET stage = 'sold'
 WHERE stage = 'new_lead'
   AND status IN ('active', 'completed');

UPDATE projects
   SET stage = 'lost'
 WHERE stage = 'new_lead'
   AND status = 'cancelled';

-- 3. Drop the FK + column pointing at the old leads table.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_source_lead_fk;
ALTER TABLE projects DROP COLUMN IF EXISTS source_lead_id;

-- 4. Drop the legacy leads + lead_subprojects tables entirely.
DROP TABLE IF EXISTS lead_subprojects CASCADE;
DROP TABLE IF EXISTS leads CASCADE;

COMMIT;
