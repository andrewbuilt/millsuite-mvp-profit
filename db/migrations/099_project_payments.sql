-- ============================================================================
-- 099 — project_payments  (the cash ledger)
-- ============================================================================
-- Andrew: "really the payment bookkeeping happens in QB, not here. this is an
-- internal cash flow tool… it's really a ledger of the transactions."
--
-- ⛔ WHY A NEW TABLE INSTEAD OF `client_invoice_payments` (041).
-- That table is `invoice_id uuid NOT NULL REFERENCES client_invoices`. You
-- cannot log a payment in MillSuite without first creating an invoice here —
-- and Built's invoices live in QuickBooks, so there is nothing to hang one on.
-- That requirement is very likely why reconciling payments never worked in
-- Built OS. This ledger hangs off the PROJECT and requires no invoice.
--
-- ⛔ WHY IT EXISTS AT ALL — the structural bug it fixes.
-- A milestone row (cash_flow_receivables) has been BOTH the plan and the
-- payment record: `status='received'` plus the *projected* `amount`. One row
-- doing two jobs, so a payment that differs from its projection has nowhere to
-- go. Andrew: "when someone pays a different amount than what we're projecting
-- … getting the math to link was not working for a while."
--
-- Separating them makes the hard cases ordinary:
--     received  = sum(project_payments)
--     remaining = contract total − received
--     the unpaid part of the schedule is rebalanced to equal `remaining`,
--     with the FINAL draw absorbing the difference.
-- Partial payments, overpayments and out-of-order payments are then just rows.
--
-- ⛔ THE SCHEDULE IS NOT REWRITTEN BY ANY OF THIS. Draw amounts stay exactly as
-- authored; the balancing is DERIVED at read time (lib/payment-ledger). This
-- codebase has twice been bitten by a screen that silently wrote recomputed
-- money back — the staleness refresh banking a $0 material, and the handoff
-- re-pricing a frozen import. A ledger must never edit the contract.
--
-- NEGATIVE AMOUNTS ARE ALLOWED (refunds, corrections, a bounced check) — hence
-- `amount <> 0` rather than `amount > 0`. Zero is meaningless and always a
-- mistake, so it's refused.
--
-- `qb_event_id` is a hook for a future QuickBooks watcher. NOT a feature now:
-- entry is manual and bookkeeping stays in QB.
--
-- Idempotent. RLS follows the `tasks`/`projects` FOR-ALL org pattern (083/093).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.project_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  -- CASCADE: a deleted project's payment history has nothing left to describe.
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- numeric, not integer: a real payment can carry cents even though draws are
  -- authored in whole dollars.
  amount        numeric NOT NULL,
  -- A calendar day, not a timestamp. ⛔ Always write it from the LOCAL date
  -- (lib/payments todayStamp) — `toISOString().slice(0,10)` is the UTC day and
  -- rolls over at 8pm Eastern, putting evening payments in tomorrow, and on the
  -- last evening of a month into the wrong month entirely.
  payment_date  date NOT NULL,
  method        text NULL
                  CHECK (method IS NULL OR method IN ('check','ach','card','cash','other')),
  reference     text NULL,
  notes         text NULL,
  -- Future QB watcher. Nothing reads it yet.
  qb_event_id   uuid NULL,
  created_by    uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_payments_project
  ON public.project_payments(project_id);
CREATE INDEX IF NOT EXISTS idx_project_payments_org
  ON public.project_payments(org_id);
-- The /payments page groups by the month money arrived.
CREATE INDEX IF NOT EXISTS idx_project_payments_date
  ON public.project_payments(org_id, payment_date);

-- A zero-dollar payment is always a mistake; a negative one is a refund.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_payments_amount_nonzero'
  ) THEN
    ALTER TABLE public.project_payments
      ADD CONSTRAINT project_payments_amount_nonzero CHECK (amount <> 0);
  END IF;
END $$;

COMMENT ON TABLE public.project_payments IS
  'Cash actually received against a project — the ledger half of the payments '
  'model. Deliberately NOT tied to an invoice (see client_invoice_payments, '
  'which requires one): Built''s invoices live in QuickBooks. The draw '
  'schedule in cash_flow_receivables is the PLAN; this is what happened.';

COMMENT ON COLUMN public.project_payments.amount IS
  'Dollars received. May be negative for a refund or correction; never zero.';

-- ── RLS ──
-- FOR ALL scoped to the caller's org, matching `tasks` (093) and `projects`
-- (083). Anyone who can see the project can record money against it.

ALTER TABLE public.project_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_payments_own_org ON public.project_payments;
CREATE POLICY project_payments_own_org ON public.project_payments
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

COMMIT;

NOTIFY pgrst, 'reload schema';
