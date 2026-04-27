-- ============================================================================
-- 041 — Client invoices
-- ============================================================================
-- Customer-facing AR invoices, distinct from the existing `invoices` table
-- which tracks incoming vendor bills (parsed from uploaded PDFs and used
-- in project-outcome / weekly-snapshot / dashboard rollups). The two
-- concepts are unrelated — vendor `invoices` are AP, these are AR — so
-- they live in separate tables with different shapes.
--
-- Three tables — client_invoices (header), client_invoice_line_items,
-- client_invoice_payments — plus six org-level columns that drive
-- prefilled values in the create-invoice modal.
--
-- Invoices link back to a project, optionally to a client, and optionally
-- to a cash_flow_receivables row (the milestone that triggered the
-- invoice). The milestone link is ON DELETE SET NULL so deleting a
-- milestone leaves the invoice intact — invoices are AR records, not
-- forecast rows.
--
-- PR1 lands schema + draft/list/create flow only. PDF generation
-- (PR-2) and payment recording (PR-3) hang off these same tables —
-- pdf_url + client_invoice_payments + qb_event_id all stub for those flows.
-- ============================================================================

BEGIN;

-- 1. orgs settings columns -------------------------------------------------

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS invoice_prefix              text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS next_invoice_number         int     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS default_tax_pct             numeric NULL,
  ADD COLUMN IF NOT EXISTS default_payment_terms_days  int     NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS invoice_email_template      text    NULL,
  ADD COLUMN IF NOT EXISTS invoice_footer_text         text    NULL;

-- 2. client_invoices -------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.client_invoices (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL,
  project_id           uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  client_id            uuid NULL REFERENCES public.clients(id) ON DELETE SET NULL,
  invoice_number       text NOT NULL,
  invoice_date         date NOT NULL,
  due_date             date NOT NULL,
  status               text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','sent','partial','paid','overdue','void')),
  subtotal             numeric NOT NULL DEFAULT 0,
  tax_pct              numeric NOT NULL DEFAULT 0,
  tax_amount           numeric NOT NULL DEFAULT 0,
  total                numeric NOT NULL DEFAULT 0,
  amount_received      numeric NOT NULL DEFAULT 0,
  notes                text,
  internal_notes       text,
  linked_milestone_id  uuid NULL REFERENCES public.cash_flow_receivables(id) ON DELETE SET NULL,
  pdf_url              text NULL,
  sent_at              timestamptz NULL,
  paid_at              timestamptz NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_invoices_project  ON public.client_invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_client_invoices_status   ON public.client_invoices(org_id, status);
CREATE INDEX IF NOT EXISTS idx_client_invoices_org_date ON public.client_invoices(org_id, invoice_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_invoices_org_number
  ON public.client_invoices(org_id, invoice_number);

-- 3. client_invoice_line_items --------------------------------------------

CREATE TABLE IF NOT EXISTS public.client_invoice_line_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid NOT NULL REFERENCES public.client_invoices(id) ON DELETE CASCADE,
  sort_order   int  NOT NULL DEFAULT 0,
  description  text NOT NULL,
  quantity     numeric NOT NULL DEFAULT 1,
  unit         text NULL,
  unit_price   numeric NOT NULL DEFAULT 0,
  amount       numeric NOT NULL DEFAULT 0,
  source_type  text NULL CHECK (source_type IN ('milestone','subproject','change_order','custom')),
  source_id    uuid NULL
);
CREATE INDEX IF NOT EXISTS idx_client_invoice_lines_invoice
  ON public.client_invoice_line_items(invoice_id, sort_order);

-- 4. client_invoice_payments ----------------------------------------------

CREATE TABLE IF NOT EXISTS public.client_invoice_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      uuid NOT NULL REFERENCES public.client_invoices(id) ON DELETE CASCADE,
  amount          numeric NOT NULL,
  payment_date    date NOT NULL,
  payment_method  text NULL CHECK (payment_method IS NULL OR payment_method IN ('check','ach','card','cash','other')),
  reference       text NULL,
  notes           text NULL,
  qb_event_id     uuid NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_invoice_payments_invoice
  ON public.client_invoice_payments(invoice_id);

-- 5. RLS — org-scoped via users.auth_user_id (mirrors migration 038) ------

ALTER TABLE public.client_invoices             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_invoice_line_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_invoice_payments     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_invoices_select ON public.client_invoices;
DROP POLICY IF EXISTS client_invoices_insert ON public.client_invoices;
DROP POLICY IF EXISTS client_invoices_update ON public.client_invoices;
DROP POLICY IF EXISTS client_invoices_delete ON public.client_invoices;

CREATE POLICY client_invoices_select ON public.client_invoices FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = client_invoices.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY client_invoices_insert ON public.client_invoices FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = client_invoices.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY client_invoices_update ON public.client_invoices FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = client_invoices.org_id AND u.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = client_invoices.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY client_invoices_delete ON public.client_invoices FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = client_invoices.org_id AND u.auth_user_id = auth.uid()));

DROP POLICY IF EXISTS client_invoice_lines_select ON public.client_invoice_line_items;
DROP POLICY IF EXISTS client_invoice_lines_insert ON public.client_invoice_line_items;
DROP POLICY IF EXISTS client_invoice_lines_update ON public.client_invoice_line_items;
DROP POLICY IF EXISTS client_invoice_lines_delete ON public.client_invoice_line_items;

CREATE POLICY client_invoice_lines_select ON public.client_invoice_line_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.client_invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = client_invoice_line_items.invoice_id AND u.auth_user_id = auth.uid()
  ));
CREATE POLICY client_invoice_lines_insert ON public.client_invoice_line_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.client_invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = client_invoice_line_items.invoice_id AND u.auth_user_id = auth.uid()
  ));
CREATE POLICY client_invoice_lines_update ON public.client_invoice_line_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.client_invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = client_invoice_line_items.invoice_id AND u.auth_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.client_invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = client_invoice_line_items.invoice_id AND u.auth_user_id = auth.uid()
  ));
CREATE POLICY client_invoice_lines_delete ON public.client_invoice_line_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.client_invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = client_invoice_line_items.invoice_id AND u.auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS client_invoice_payments_select ON public.client_invoice_payments;
DROP POLICY IF EXISTS client_invoice_payments_insert ON public.client_invoice_payments;
DROP POLICY IF EXISTS client_invoice_payments_update ON public.client_invoice_payments;
DROP POLICY IF EXISTS client_invoice_payments_delete ON public.client_invoice_payments;

CREATE POLICY client_invoice_payments_select ON public.client_invoice_payments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.client_invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = client_invoice_payments.invoice_id AND u.auth_user_id = auth.uid()
  ));
CREATE POLICY client_invoice_payments_insert ON public.client_invoice_payments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.client_invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = client_invoice_payments.invoice_id AND u.auth_user_id = auth.uid()
  ));
CREATE POLICY client_invoice_payments_update ON public.client_invoice_payments FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.client_invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = client_invoice_payments.invoice_id AND u.auth_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.client_invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = client_invoice_payments.invoice_id AND u.auth_user_id = auth.uid()
  ));
CREATE POLICY client_invoice_payments_delete ON public.client_invoice_payments FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.client_invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = client_invoice_payments.invoice_id AND u.auth_user_id = auth.uid()
  ));

COMMIT;
