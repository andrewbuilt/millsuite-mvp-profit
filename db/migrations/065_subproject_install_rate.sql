-- ============================================================================
-- 065 — per-subproject install rate override
-- ============================================================================
-- 6a-3 (project-level install block). MillSuite's install prefill priced
-- install labor at the org shop rate. Built's install card lets you set the
-- rate per install (default ~$68/hr). Add an optional per-subproject override:
-- NULL = use the org shop rate (unchanged behavior); a value = use it instead.
--
-- Idempotent. Run against prod Supabase before deploying the code that reads
-- it (the InstallPrefill card + project rollup).
-- ============================================================================

ALTER TABLE public.subprojects
  ADD COLUMN IF NOT EXISTS install_rate_per_hour numeric;

NOTIFY pgrst, 'reload schema';
