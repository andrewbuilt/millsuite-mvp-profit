-- ============================================================================
-- 097 — subprojects.quantity  ("QTY 4 of this cabinet")
-- ============================================================================
-- Andrew: "We have a QTY 4 of this cabinet, but no way to price multiples."
-- A subproject named "Millwork Cabinet (TYP)" is one unit priced once; the job
-- needs four of them. Until now the only options were to duplicate the
-- subproject four times or to do the arithmetic by hand on every line.
--
-- The multiplier scales the LINE-DERIVED buckets — labor, material, hardware,
-- consumables, options, custom — and the department hours with them, because
-- four cabinets really are four times the shop work and the schedule has to
-- see that.
--
-- ⛔ IT DELIBERATELY DOES NOT SCALE THE INSTALL BLOCK. Install is already an
-- explicit site estimate (guys x days x rate); four cabinets in one room is
-- not four mobilisations, so multiplying it would overstate the number.
-- Andrew's call, 2026-09-04. Bump days by hand when it genuinely takes longer.
--
-- Defaults to 1 and is NOT NULL, so every existing subproject keeps its exact
-- current price — this migration cannot move any money on its own.
--
-- Idempotent. No RLS change; subprojects already carries its policy.
-- ============================================================================

BEGIN;

ALTER TABLE public.subprojects
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;

-- A zero or negative quantity would silently zero or negate a subproject's
-- price, so the database refuses it rather than trusting every caller.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subprojects_quantity_positive'
  ) THEN
    ALTER TABLE public.subprojects
      ADD CONSTRAINT subprojects_quantity_positive CHECK (quantity >= 1);
  END IF;
END $$;

COMMENT ON COLUMN public.subprojects.quantity IS
  'How many of this subproject the job includes (a "(TYP)" unit). Scales the '
  'line-derived cost buckets and department hours. Does NOT scale the install '
  'prefill, which is an explicit site estimate. Default 1.';

COMMIT;

NOTIFY pgrst, 'reload schema';
