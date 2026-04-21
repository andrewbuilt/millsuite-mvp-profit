-- ============================================================================
-- Migration 016 — consolidate projects.status + projects.production_phase into
-- a single projects.stage field
-- ============================================================================
-- Before: three overlapping fields tracked where a project was:
--   stage            — sales pipeline: new_lead | fifty_fifty | ninety_percent | sold | lost
--   status           — shop lifecycle:  bidding | active | complete(d) | cancelled | archived
--   production_phase — shop sub-stage:  pre_production | scheduling | in_production | null
--
-- After: one field, full pipeline from first lead to closed job:
--   stage — new_lead | fifty_fifty | ninety_percent | sold | production | installed
--         | complete | lost
--
-- The mockups treat this as a single 5-node strip on the project cover
-- (bidding → sold → production → installed → complete, with bidding
-- standing in for any pre-sold stage). Keeping three fields meant every
-- reader had to stitch them together and every writer had to mutate all
-- three atomically — this cut that out.
--
-- No users yet, so we drop the old columns outright instead of layering
-- views. Backfill preserves current state as best it can.
-- ============================================================================

BEGIN;

-- 1. Drop the old stage CHECK so we can expand the allowed values.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_stage_check;

-- 2. Backfill the unified stage from the pre-existing fields. Order matters —
--    'complete' beats 'installed' beats 'production' beats 'sold'. Anything
--    already carrying a sales stage (new_lead / fifty_fifty / ninety_percent /
--    lost) stays put.
UPDATE projects
   SET stage = CASE
     WHEN stage IN ('sold') AND status IN ('complete', 'completed', 'archived') THEN 'complete'
     WHEN stage = 'sold' AND production_phase = 'in_production'                THEN 'production'
     WHEN stage = 'sold' AND production_phase = 'scheduling'                   THEN 'production'
     WHEN stage = 'sold' AND production_phase = 'pre_production'               THEN 'sold'
     WHEN stage = 'sold'                                                       THEN 'sold'
     WHEN stage = 'lost'                                                       THEN 'lost'
     ELSE stage
   END;

-- 3. Re-apply the CHECK with the expanded set.
ALTER TABLE projects
  ADD CONSTRAINT projects_stage_check
  CHECK (stage IN (
    'new_lead', 'fifty_fifty', 'ninety_percent',
    'sold', 'production', 'installed', 'complete',
    'lost'
  ));

-- 4. Drop the now-redundant fields. If anything is still selecting them the
--    type-check will catch it at build time.
ALTER TABLE projects DROP COLUMN IF EXISTS status;
ALTER TABLE projects DROP COLUMN IF EXISTS production_phase;

-- 5. Refresh the index to match.
DROP INDEX IF EXISTS idx_projects_org_status;
DROP INDEX IF EXISTS idx_projects_org_stage;
CREATE INDEX idx_projects_org_stage ON projects(org_id, stage);

COMMIT;
