-- ============================================================================
-- 136 — more than one contact on a job (2026-11-24, Andrew)
-- ============================================================================
-- A job has a point of contact, and often a GC and a designer too. Until now
-- the extra people got typed into "Site access" as a line of text. They get
-- their own list, each with a CATEGORY (GC, designer, architect, owner, site
-- super, other), shown on the pre-production Handoff card and on the client's
-- approval portal.
--
-- The POINT OF CONTACT stays exactly where it is — projects.poc_name /
-- poc_phone / poc_email (125). Those three columns are what the production
-- gate reads (lib/handoff), so nothing about the gate changes: these extra
-- contacts are reference, they never gate.
--
-- One jsonb array on the project rather than a table: a handful of rows per
-- job, always read and written together with the job, never queried across
-- jobs. Shape (lib/handoff-contacts.ts): [{ id, category, name, phone, email }].
--
-- ⛔ No new RLS surface: the column rides the existing projects policy
-- (authenticated, own org). The portal reads and writes it through its
-- service-role routes only, like everything else on /p.
--
-- Idempotent. Run against prod Supabase BEFORE deploying the code that needs it.
-- ============================================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS handoff_contacts jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.projects.handoff_contacts IS
  'Extra job contacts beyond the POC: [{id, category, name, phone, email}]. Reference only — never gates production. (136)';

NOTIFY pgrst, 'reload schema';
