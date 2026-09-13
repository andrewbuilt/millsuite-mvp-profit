-- ============================================================================
-- 105 — drop bom_items. The BOM parser is dead.
-- ============================================================================
-- Built 2026-09-12 (103), killed 2026-09-13 after one test against a real
-- approval set. Andrew: "the only thing that matters is the sheet count. we
-- can read '4 drawers' more quickly than parsing. we dont need AI to tell us
-- we need to order 8 pieces of glass."
--
-- ⛔ WHY IT DIED, WRITTEN DOWN SO NOBODY REBUILDS IT.
--
-- Tested on Approval_Murtagh_Bar.pdf. Every count was wrong, most by 2x:
--   drawers      4 actual  → 8 reported   (it saw the same bank in the
--                                          section AND the elevation and
--                                          added them — its own note said so)
--   mesh inserts 4         → 6, plus a duplicate line for the same material
--   doors        8         → 12
--   glass shelves 8        → 6
--   sheet goods  unknowable → 30, stated confidently
--
-- The counts were fixable — the PDF carries a full text layer with
-- `19-1/8" x4` and `EQ x4` in it, and the pipeline extracts that text and
-- throws it away (it only measures its LENGTH to guess "is this scanned?").
-- Feeding it through would very likely have fixed the counting.
--
-- ⛔ BUT FIXING THE COUNTS WOULD NOT HAVE MADE IT WORTH HAVING, which is the
-- actual lesson. The only number the shop can't get faster by looking is the
-- SHEET COUNT — and that needs part sizes and nesting, which happens on the
-- PRODUCTION drawings, not these. Everything the parser could ever be good at
-- (4 drawers, 8 glass shelves) is something a human reads off the elevation
-- in seconds. A feature that automates the easy half of a job and can't touch
-- the hard half is not worth its maintenance.
--
-- ⚠️ IF SOMEONE REVIVES THIS: the question to answer FIRST is "can it produce
-- a sheet count", not "can it produce accurate counts". If the answer is no,
-- stop. That requires nesting, which is a different product.
--
-- Two findings from the exercise ARE worth keeping — see STATE:
--   1. /api/parse-drawings ignores the PDF text layer entirely. The ESTIMATE
--      takeoff, which Built actually uses, is guessing at dimensions that are
--      sitting in the file as text.
--   2. The composer prices doors by LINEAR FOOT, not by count, so there is no
--      door count anywhere in the estimate.
--
-- The table is empty (verified — the audit reported "bom_items (empty)"), so
-- nothing is lost. `supply_items` (102) STAYS: it's a separate feature and a
-- useful one.
--
-- ROLLBACK: re-run 103.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS public.bom_items;

COMMIT;

NOTIFY pgrst, 'reload schema';
