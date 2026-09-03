-- ============================================================================
-- 095 — presentation estimate template (Small fixes / Presentation estimate)
-- ============================================================================
-- A SECOND estimate template, not a replacement. The standard one keeps
-- rendering exactly as it does today — it's what Bam and the B2B work go out
-- on. This adds the switch and the two pieces of copy the premium template
-- needs to be per-shop rather than hardcoded to Built.
--
--   estimate_template_default — the org's default choice.
--
--   projects.estimate_template — STAMPED at send time, nullable. This is the
--   important one: an estimate that went out on the presentation template must
--   REGENERATE on the presentation template months later, even if the org
--   default has since changed. Nullable means "never chosen" → fall back to
--   the org default; it is not the same as 'standard'.
--
--   projects.estimate_headline — the cover's editorial sentence ("A custom
--   millwork package for the Williams residence."). Auto-generated at send
--   time but editable, and persisted for the same reason as the template: a
--   regenerate must reproduce the document that was actually sent, not a
--   freshly-guessed sentence.
--
--   orgs.estimate_cover_stats — the small dotted-rule row on the closing page
--   ("2013 / Family owned since", "15 / Craftspeople"). jsonb array of
--   {value,label}. Empty array ⇒ the row is omitted entirely, which is the
--   right default for every shop that isn't Built. NB the column name says
--   "cover" because the stats were on the cover in the first design; Andrew
--   moved them to the closing page. Kept the name rather than churn it.
--
-- Idempotent. No RLS changes — both tables already carry their policies.
-- ============================================================================

BEGIN;

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS estimate_template_default text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS estimate_cover_stats jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Guard the enum-ish column rather than trusting callers. Added separately and
-- defensively so re-running the migration doesn't fail on an existing
-- constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orgs_estimate_template_default_check'
  ) THEN
    ALTER TABLE public.orgs
      ADD CONSTRAINT orgs_estimate_template_default_check
      CHECK (estimate_template_default IN ('standard', 'presentation'));
  END IF;
END $$;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS estimate_template text NULL,
  ADD COLUMN IF NOT EXISTS estimate_headline text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_estimate_template_check'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_estimate_template_check
      CHECK (estimate_template IS NULL OR estimate_template IN ('standard', 'presentation'));
  END IF;
END $$;

COMMENT ON COLUMN public.projects.estimate_template IS
  'Template this project''s estimate was SENT on. NULL = never chosen, fall '
  'back to orgs.estimate_template_default. Stamped so a regenerate reproduces '
  'the document that was actually sent.';

COMMENT ON COLUMN public.orgs.estimate_cover_stats IS
  'jsonb array of {value,label} for the closing page''s small stat row. Empty '
  'array omits the row. Named "cover" from the first design; the stats now sit '
  'on the closing page.';

COMMIT;

NOTIFY pgrst, 'reload schema';
