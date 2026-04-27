-- ============================================================================
-- 041 — Invoices
-- ============================================================================
-- Three tables — invoices (header), invoice_line_items, invoice_payments —
-- plus six org-level columns that drive prefilled values in the create-
-- invoice modal.
--
-- Invoices link back to a project, optionally to a client, and optionally
-- to a cash_flow_receivables row (the milestone that triggered the
-- invoice). The milestone link is ON DELETE SET NULL so deleting a
-- milestone leaves the invoice intact — invoices are AR records, not
-- forecast rows.
--
-- PR1 lands schema + draft/list/create flow only. PDF generation
-- (PR-2) and payment recording (PR-3) hang off these same tables —
-- pdf_url + invoice_payments + qb_event_id all stub for those flows.
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

-- 2. invoices --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.invoices (
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
CREATE INDEX IF NOT EXISTS idx_invoices_project  ON public.invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON public.invoices(org_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_org_date ON public.invoices(org_id, invoice_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_org_number
  ON public.invoices(org_id, invoice_number);

-- 3. invoice_line_items ----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  sort_order   int  NOT NULL DEFAULT 0,
  description  text NOT NULL,
  quantity     numeric NOT NULL DEFAULT 1,
  unit         text NULL,
  unit_price   numeric NOT NULL DEFAULT 0,
  amount       numeric NOT NULL DEFAULT 0,
  source_type  text NULL CHECK (source_type IN ('milestone','subproject','change_order','custom')),
  source_id    uuid NULL
);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON public.invoice_line_items(invoice_id, sort_order);

-- 4. invoice_payments ------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount          numeric NOT NULL,
  payment_date    date NOT NULL,
  payment_method  text NULL CHECK (payment_method IS NULL OR payment_method IN ('check','ach','card','cash','other')),
  reference       text NULL,
  notes           text NULL,
  qb_event_id     uuid NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON public.invoice_payments(invoice_id);

-- 5. RLS — org-scoped via users.auth_user_id (mirrors migration 038) ------

ALTER TABLE public.invoices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_payments    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoices_select ON public.invoices;
DROP POLICY IF EXISTS invoices_insert ON public.invoices;
DROP POLICY IF EXISTS invoices_update ON public.invoices;
DROP POLICY IF EXISTS invoices_delete ON public.invoices;

CREATE POLICY invoices_select ON public.invoices FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = invoices.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY invoices_insert ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = invoices.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY invoices_update ON public.invoices FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = invoices.org_id AND u.auth_user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = invoices.org_id AND u.auth_user_id = auth.uid()));
CREATE POLICY invoices_delete ON public.invoices FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.org_id = invoices.org_id AND u.auth_user_id = auth.uid()));

-- Line items + payments scope through the parent invoice's org_id.

DROP POLICY IF EXISTS invoice_lines_select ON public.invoice_line_items;
DROP POLICY IF EXISTS invoice_lines_insert ON public.invoice_line_items;
DROP POLICY IF EXISTS invoice_lines_update ON public.invoice_line_items;
DROP POLICY IF EXISTS invoice_lines_delete ON public.invoice_line_items;

CREATE POLICY invoice_lines_select ON public.invoice_line_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = invoice_line_items.invoice_id AND u.auth_user_id = auth.uid()
  ));
CREATE POLICY invoice_lines_insert ON public.invoice_line_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = invoice_line_items.invoice_id AND u.auth_user_id = auth.uid()
  ));
CREATE POLICY invoice_lines_update ON public.invoice_line_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = invoice_line_items.invoice_id AND u.auth_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = invoice_line_items.invoice_id AND u.auth_user_id = auth.uid()
  ));
CREATE POLICY invoice_lines_delete ON public.invoice_line_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = invoice_line_items.invoice_id AND u.auth_user_id = auth.uid()
  ));

DROP POLICY IF EXISTS invoice_payments_select ON public.invoice_payments;
DROP POLICY IF EXISTS invoice_payments_insert ON public.invoice_payments;
DROP POLICY IF EXISTS invoice_payments_update ON public.invoice_payments;
DROP POLICY IF EXISTS invoice_payments_delete ON public.invoice_payments;

CREATE POLICY invoice_payments_select ON public.invoice_payments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = invoice_payments.invoice_id AND u.auth_user_id = auth.uid()
  ));
CREATE POLICY invoice_payments_insert ON public.invoice_payments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = invoice_payments.invoice_id AND u.auth_user_id = auth.uid()
  ));
CREATE POLICY invoice_payments_update ON public.invoice_payments FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = invoice_payments.invoice_id AND u.auth_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = invoice_payments.invoice_id AND u.auth_user_id = auth.uid()
  ));
CREATE POLICY invoice_payments_delete ON public.invoice_payments FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.invoices i
    JOIN public.users u ON u.org_id = i.org_id
    WHERE i.id = invoice_payments.invoice_id AND u.auth_user_id = auth.uid()
  ));

COMMIT;
