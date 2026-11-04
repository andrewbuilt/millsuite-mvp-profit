-- ============================================================================
-- 131 — Engineering board round 2 (STATE.md, 2026-11-05)
-- ============================================================================
--   board_hours  numeric NULL  — the scheduled engineering budget for the
--                strip (TOTAL hours incl. what's already tracked), separate
--                from the estimate rollup. Batia: 163.7h est, break out 40h.
--                ⛔ NULL = the full estimate — exactly v1's behaviour — so no
--                backfill is needed and nothing moves when this runs.
--   start_date   date NULL     — a strip dragged sideways is pinned to start
--                here (deliberate overbooking allowed). NULL = auto-pack.
--   done_at      timestamptz NULL — "Engineering done": the ONLY way a strip
--                leaves the board (going over its hours never removes it).
-- Additive; safe to run before the code that reads it.
-- ============================================================================

BEGIN;

ALTER TABLE public.eng_assignments ADD COLUMN IF NOT EXISTS board_hours numeric;
ALTER TABLE public.eng_assignments ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE public.eng_assignments ADD COLUMN IF NOT EXISTS done_at timestamptz;

COMMIT;

NOTIFY pgrst, 'reload schema';
