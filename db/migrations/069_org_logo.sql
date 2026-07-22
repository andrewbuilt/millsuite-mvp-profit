-- ============================================================================
-- 069 — orgs.logo_url (shop logo for header / logins / estimate·invoice·CO PDFs)
-- ============================================================================
-- Public URL of the org's uploaded logo (stored in the existing public
-- invoice-pdfs bucket under logos/{orgId}/…). Nullable — the app falls back to
-- the name/initial when unset. Idempotent. Run against prod before deploying.
-- ============================================================================

BEGIN;

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS logo_url text;

NOTIFY pgrst, 'reload schema';

COMMIT;
