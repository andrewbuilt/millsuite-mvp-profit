-- ============================================================================
-- 091 — orgs.estimate_closing_note (small-fixes wave, item 9)
-- ============================================================================
-- A warm sign-off block at the very end of the estimate PDF ("Thank you").
--
-- This is a per-org SETTING, deliberately not hardcoded copy: the blurb is
-- Built's — family owned since 2013, the headcount, the pets — and every other
-- org on the platform would be thanking a client on Built's behalf. Bam
-- Woodworks is already live, so shared copy here would be a visible bug.
--
-- Nullable, no default: an org that hasn't written one renders the PDF exactly
-- as it does today (the Thank-you section doesn't render at all).
--
-- Written from Settings through lib/org-write.ts — NEVER a bare
-- `from('orgs').update()` in the browser (RLS returns success-shaped silence
-- on a zero-row update; see the warning at the top of STATE.md).
--
-- Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS estimate_closing_note text NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
