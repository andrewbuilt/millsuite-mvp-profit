-- ============================================================================
-- 108 — the import price freeze belongs to the SUBPROJECT, not the project
-- ============================================================================
-- ⛔ THE BUG. `recomputeProjectBidTotal` (and the project page, the subproject
-- editor and the handoff page) read `projects.imported_at` and, when set,
-- price the ENTIRE project frozen: shop rate 0, consumables 0, every margin 0.
--
-- That is correct for Built's migrated lines. Each one carries Built's quoted
-- price verbatim as a material lump, so adding labor dollars or margin on top
-- would charge twice for work Built already charged for. (The handoff page
-- once lacked this and showed $257,907 against the project page's $168,090 —
-- and selling would have written that number into the contract.)
--
-- ⛔ BUT IT ALSO APPLIES TO SCOPE ADDED AFTER THE IMPORT. A subproject created
-- today on an imported job — real composer lines, real hours — prices at
-- MATERIAL COST with ZERO labor and ZERO margin. On a $5,000 addition that is
-- thousands of dollars given away, silently, with the right-looking number on
-- screen.
--
-- Change orders v2 walks straight into it: Pajot is an imported job, and
-- accepting a CO materialises exactly such a subproject. The client signs
-- $5,000 and the contract total moves by the material figure alone.
--
-- ⛔ THE FIX IS PER-SUBPROJECT, AND IT IS EXPLICIT. `imported_at` answers "did
-- this project come from Built", which is a fact about its HISTORY. Pricing
-- needs "does this row already contain its price", which is a fact about the
-- ROW. Those were the same thing on the day of the import and have been
-- drifting apart ever since.
--
-- ⚠️ DEFAULT false, and the readers fall back to `imported_at` when the column
-- is ABSENT from a select — so a caller that forgets to ask for it behaves
-- exactly as it does today (frozen) rather than silently un-freezing a real
-- contract. The unsafe direction is the one that can't happen by accident.
--
-- ⛔ THIS MIGRATION REPRICES NOTHING TODAY. The backfill freezes every
-- subproject that came out of Built (`migration_id_map`) plus anything that
-- existed at import time. The only rows left live are Batia's two
-- post-import subprojects, which have ZERO estimate lines — so every
-- project's bid_total is bit-identical before and after. It changes what
-- happens to scope added FROM NOW ON.
--
-- ROLLBACK:
--   ALTER TABLE public.subprojects DROP COLUMN IF EXISTS price_frozen;
-- ============================================================================

BEGIN;

ALTER TABLE public.subprojects
  ADD COLUMN IF NOT EXISTS price_frozen boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.subprojects.price_frozen IS
  'This subproject''s stored line costs ARE its quoted price: add no labor $, no consumables, no margin. Set by the Built importer. New scope on an imported job is NOT frozen — it is quoted at current rates.';

-- ── Backfill, belt and braces ──
-- (a) Anything the Built importer created, by its own record. This is the
--     authoritative list — not a heuristic.
UPDATE public.subprojects s
   SET price_frozen = true
  FROM public.migration_id_map m
 WHERE m.entity = 'subproject'
   AND m.millsuite_id = s.id
   AND s.price_frozen = false;

-- (b) Anything on an imported project that already existed when the import
--     ran. Covers subprojects created before `migration_id_map` existed (063)
--     and any hand-made row that was part of the migrated contract. The 1-day
--     window is deliberately generous: FREEZING a row that should be live is a
--     visible $0 price somebody notices, while LEAVING a migrated row live
--     re-prices a signed contract quietly. Err toward the loud failure.
UPDATE public.subprojects s
   SET price_frozen = true
  FROM public.projects p
 WHERE p.id = s.project_id
   AND p.imported_at IS NOT NULL
   AND s.created_at <= p.imported_at + interval '1 day'
   AND s.price_frozen = false;

COMMIT;

NOTIFY pgrst, 'reload schema';
