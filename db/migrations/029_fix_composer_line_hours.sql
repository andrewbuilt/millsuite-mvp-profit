-- Migration 029 - fix composer-saved estimate_lines whose dept_hour_overrides
-- were stored as qty-multiplied totals instead of per-unit.
-- Per Phase 12 dogfood-4 Issue 18.
--
-- Root cause: lib/composer.ts computeBreakdown returns hours-by-dept for
-- the WHOLE LINE at the chosen qty. lib/composer-persist.ts saveComposerLine
-- was writing those totals straight into dept_hour_overrides, but
-- lib/estimate-lines.ts computeLineBuildup treats dept_hour_overrides as
-- per-unit and multiplies by quantity at read time. Net effect: composer
-- lines render at qty² hours.
--
-- Fix: divide already-saved composer overrides by quantity. The save path
-- was patched in the same PR so future writes are per-unit.
--
-- Identify composer-origin rows by product_key + product_slots both being
-- non-null. Lines saved by other paths use per-unit overrides correctly
-- and must not be touched.
--
-- Idempotency guard: a composer_hours_corrected boolean column. Migration
-- divides only rows where it's still false; the patched save path stamps
-- it true on every new write so this migration is safe to re-run.

BEGIN;

ALTER TABLE public.estimate_lines
  ADD COLUMN IF NOT EXISTS composer_hours_corrected boolean NOT NULL DEFAULT false;

UPDATE public.estimate_lines
   SET dept_hour_overrides = (
         SELECT jsonb_object_agg(
                  k,
                  CASE
                    WHEN jsonb_typeof(v) = 'number' AND quantity > 0
                      THEN to_jsonb((v::text)::numeric / quantity)
                    ELSE v
                  END
                )
           FROM jsonb_each(dept_hour_overrides) AS kv(k, v)
       ),
       composer_hours_corrected = true
 WHERE product_key      IS NOT NULL
   AND product_slots    IS NOT NULL
   AND quantity         > 0
   AND dept_hour_overrides IS NOT NULL
   AND composer_hours_corrected = false;

COMMIT;

-- DOWN reference: there is no clean down. Once divided, the original
-- totals are gone. Recover by re-running the upstream save against the
-- original draft. Keep the marker column even on revert so future
-- migrations can detect corrected rows.
