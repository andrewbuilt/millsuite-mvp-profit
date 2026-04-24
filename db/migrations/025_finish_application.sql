-- Migration 025 - rate_book_items.application for interior vs exterior finishes.
-- Per BUILD-ORDER Phase 12 Item 6 + specs/add-line-composer/README.md amendment.
--
-- Today both composer finish dropdowns read from the same finish list, so
-- any finish recipe shows up on both sides. Interior and exterior are
-- different problems - different surface area, different labor, different
-- material consumption - so operators want them as distinct rate-book rows.
--
-- This migration adds the discriminator. application is NULL for every
-- non-finish item (cabinet_style, door_style, drawer_style, custom). For
-- item_type = 'finish' rows it must be 'interior' or 'exterior'.
--
-- Backfill: every existing finish row ships as 'exterior' - that is how
-- they have been used until now (doors, drawer fronts, end panels). The
-- Item 8 FinishWalkthrough rewrite adds a "Duplicate for the other
-- application" affordance so operators can create interior twins when
-- they actually finish cabinet interiors.
--
-- RLS: not changed here. Migration 024 covers rate_book_items.
--
-- Idempotent.

BEGIN;

ALTER TABLE public.rate_book_items
  ADD COLUMN IF NOT EXISTS application text NULL;

ALTER TABLE public.rate_book_items
  DROP CONSTRAINT IF EXISTS rate_book_items_application_valid;
ALTER TABLE public.rate_book_items
  ADD CONSTRAINT rate_book_items_application_valid
    CHECK (application IS NULL OR application IN ('interior', 'exterior'));

UPDATE public.rate_book_items ri
   SET application = 'exterior'
  FROM public.rate_book_categories rc
 WHERE ri.category_id = rc.id
   AND rc.item_type = 'finish'
   AND ri.application IS NULL;

COMMIT;

-- DOWN migration reference:
--   BEGIN;
--   ALTER TABLE public.rate_book_items
--     DROP CONSTRAINT IF EXISTS rate_book_items_application_valid;
--   ALTER TABLE public.rate_book_items
--     DROP COLUMN IF EXISTS application;
--   COMMIT;
