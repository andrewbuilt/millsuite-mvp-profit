-- ============================================================================
-- 061 — QuickBooks invoice id on client_invoices (one-invoice-per-project)
-- ============================================================================
-- The new model pushes ONE invoice per project (= the contract) to QuickBooks,
-- instead of one invoice per milestone. That invoice's QB id needs to live on
-- the invoice row — today qbo_invoice_id only exists on cash_flow_receivables
-- (per-milestone). Adding it to client_invoices lets the QB watcher match an
-- incoming draw/payment back to the single project invoice and apply it to the
-- balance. Milestones become a projection/terms schedule only.
--
-- Idempotent: safe to re-run.
--
-- Rollback:
--   ALTER TABLE public.client_invoices DROP COLUMN IF EXISTS qbo_invoice_id;
-- ============================================================================

BEGIN;

ALTER TABLE public.client_invoices
  ADD COLUMN IF NOT EXISTS qbo_invoice_id text;

NOTIFY pgrst, 'reload schema';

COMMIT;
