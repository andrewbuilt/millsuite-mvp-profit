-- ============================================================================
-- 130 — Payments v4: the ledger gets a label
-- ============================================================================
-- Payments v4 (STATE.md, 2026-11-05) unbinds the two lists:
--   LEDGER   project_payments       — money in (date · amount · label/note)
--   FORECAST cash_flow_receivables  — money coming (label · amount · month)
-- No payment settles, locks, renames or spawns a forecast row any more, so a
-- green card can no longer borrow its headline from "the draw it paid". It
-- carries its own: `project_payments.label` ("App 3", "Deposit").
--
-- ADDITIVE ONLY. Safe to run before the v4 code deploys (the v3 code never
-- reads the column). The one-time data conversion — retiring the forecast
-- rows the ledger already paid and backfilling these labels from them — is
-- NOT here: it runs as `scripts/payments-v4-convert.mjs`, dry-run listing
-- first, `--apply` only after Andrew approves the listing.
--
-- Left in place, unread by v4 (drop later if wanted, AFTER the v4 deploy):
--   cash_flow_receivables.amount_pinned   (123 — still used by the PRE-SALE
--                                          milestone composer's $ rows)
--   cash_flow_receivables.change_order_id (106) / co_doc_id (109) — 0 rows set
-- ============================================================================

BEGIN;

ALTER TABLE public.project_payments
  ADD COLUMN IF NOT EXISTS label text NULL;

COMMENT ON COLUMN public.project_payments.label IS
  'What the payment was, in the operator''s words ("App 3"). The green card headline on /payments. Never derived from a forecast row (v4, 130).';

COMMIT;

NOTIFY pgrst, 'reload schema';
