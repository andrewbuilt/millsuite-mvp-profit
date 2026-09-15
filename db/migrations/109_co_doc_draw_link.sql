-- ============================================================================
-- 109 — a change order DOCUMENT can own a draw row
-- ============================================================================
-- Migration 106 gave `cash_flow_receivables.change_order_id` so an approved v1
-- change order appends its own labelled draw instead of silently inflating the
-- final one. A v2 doc needs the same thing and CANNOT reuse that column: it
-- has a foreign key to `change_orders`, and a `co_docs` id is not one.
--
-- So: a parallel column with the same three properties, which are the ones
-- that made 106 work.
--
--   1. IDENTITY — the row says which document produced it, so the payments
--      board can explain a line the client never saw in the original schedule.
--   2. IDEMPOTENCY — a partial unique index. Acceptance runs its steps as
--      separate best-effort blocks and a doc can be re-accepted after a
--      partial failure, so "write it twice" is a real path, not a hypothetical.
--   3. PROTECTION FROM RE-IMPORT — the Built importer clears a project's
--      `status='projected'` receivables and re-inserts from Built. Built knows
--      nothing about change orders, so without a guard a re-import silently
--      DELETES the CO's draw and puts the board back to inflating the final
--      one. That already happened once and was fixed in 3c75674 for v1; the
--      same guard now has to see v2 rows too, or the fix has a hole in it
--      exactly the width of the new feature.
--
-- ⚠️ NULLABLE, no default: almost every receivable belongs to the original
-- schedule and has no document behind it.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS uniq_receivable_co_doc;
--   ALTER TABLE public.cash_flow_receivables DROP COLUMN IF EXISTS co_doc_id;
-- ============================================================================

BEGIN;

ALTER TABLE public.cash_flow_receivables
  ADD COLUMN IF NOT EXISTS co_doc_id uuid NULL
    REFERENCES public.co_docs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.cash_flow_receivables.co_doc_id IS
  'The accepted change order document that produced this draw. NULL for the original schedule. Protected from re-import the same way change_order_id is.';

-- ⛔ ONE DRAW PER DOCUMENT. See (2) above — acceptance is not a transaction.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_receivable_co_doc
  ON public.cash_flow_receivables(co_doc_id)
  WHERE co_doc_id IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
