-- ============================================================================
-- 066 — per-subproject "includes install" opt-in flag
-- ============================================================================
-- 6a-3 (piece 3). MillSuite always folded a subproject's install prefill into
-- its price. Now install is opt-in per sub: check "includes install" to count
-- that sub's install (guys × days × rate), leave it off when the standalone
-- project-level install block handles install instead — so the two never
-- double-count.
--
-- Default false (opt-in for new subs), but backfill true for any existing sub
-- that already has install set, so current pricing is unchanged.
--
-- Idempotent. Run against prod Supabase before deploying the code that reads
-- it (the InstallPrefill card + project rollup).
-- ============================================================================

ALTER TABLE public.subprojects
  ADD COLUMN IF NOT EXISTS install_included boolean NOT NULL DEFAULT false;

-- Preserve existing behavior: subs that already carry install stay included.
UPDATE public.subprojects
  SET install_included = true
  WHERE install_guys IS NOT NULL AND install_guys > 0
    AND install_days IS NOT NULL AND install_days > 0
    AND install_included = false;

NOTIFY pgrst, 'reload schema';
