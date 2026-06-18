-- ============================================================================
-- 060 — Estimate PDFs: project snapshot/number + org estimate settings
-- ============================================================================
-- Estimates become MillSuite-native downloadable PDFs (never pushed to QB).
-- This adds:
--   projects.estimate_pdf_url       — cached Storage URL of the last render
--   projects.estimate_number        — reserved once on first download (e.g. EST-0001)
--   projects.estimate_sent_at       — light audit stamp (set on download/send)
--   projects.estimate_snapshot_json — frozen lines/totals/terms at render time
--   orgs.estimate_prefix            — number prefix (defaults to "EST-" in code)
--   orgs.next_estimate_number       — numbering sequence (mirrors next_invoice_number)
--   orgs.estimate_footer_text       — default terms block on the estimate PDF
--   orgs.estimate_email_template    — copy-to-send template (mirrors invoice_email_template)
--
-- PDFs reuse the existing `invoice-pdfs` Storage bucket under an `estimates/`
-- path (its RLS keys on org_id as the first path segment) — no new bucket.
--
-- Idempotent: safe to re-run.
--
-- Rollback:
--   ALTER TABLE public.projects DROP COLUMN IF EXISTS estimate_pdf_url, DROP COLUMN IF EXISTS estimate_number,
--     DROP COLUMN IF EXISTS estimate_sent_at, DROP COLUMN IF EXISTS estimate_snapshot_json;
--   ALTER TABLE public.orgs DROP COLUMN IF EXISTS estimate_prefix, DROP COLUMN IF EXISTS next_estimate_number,
--     DROP COLUMN IF EXISTS estimate_footer_text, DROP COLUMN IF EXISTS estimate_email_template;
-- ============================================================================

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS estimate_pdf_url       text,
  ADD COLUMN IF NOT EXISTS estimate_number        text,
  ADD COLUMN IF NOT EXISTS estimate_sent_at       timestamptz,
  ADD COLUMN IF NOT EXISTS estimate_snapshot_json jsonb;

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS estimate_prefix         text,
  ADD COLUMN IF NOT EXISTS next_estimate_number    int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS estimate_footer_text    text,
  ADD COLUMN IF NOT EXISTS estimate_email_template text;

NOTIFY pgrst, 'reload schema';

COMMIT;
