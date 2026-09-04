-- ============================================================================
-- 096 — presentation estimate footer mark (round 3 item B)
-- ============================================================================
-- The presentation template's run footer shows a small org mark before the
-- address. It is deliberately NOT orgs.logo_url: that column holds the full
-- horizontal lockup (mark + wordmark), which Andrew judged muddy at footer
-- size. This column holds a footer-specific asset — for Built, the logomark
-- alone, pre-tinted to the footer gray (#B4AFA4), generated from the .ai by
-- scripts/built-footer-mark.tsx and uploaded to the org-logos bucket.
--
-- NULL ⇒ no mark in the footer (the right default for every other org).
--
-- Idempotent. No RLS changes — orgs already carries its policies.
-- ============================================================================

BEGIN;

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS estimate_footer_logo_url text NULL;

COMMENT ON COLUMN public.orgs.estimate_footer_logo_url IS
  'Small mark for the presentation estimate''s run footer. Not logo_url (the '
  'full lockup reads muddy at footer size) — a footer-specific asset, '
  'pre-tinted to the footer text color. NULL = no mark.';

COMMIT;

NOTIFY pgrst, 'reload schema';
