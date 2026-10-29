-- ============================================================================
-- 124 — `invoices` becomes THE project material-spend ledger (2026-10-29)
-- ============================================================================
-- The project P&L panel (STATE, 10-29 Cowork pass) needs a material-spend
-- ledger: vendor, amount, date, parsed-or-manual, a note, who entered it, who
-- last edited it. The spec named a new `project_expenses` table — but
-- `invoices` already IS that ledger (vendor bills against a project; the /pm
-- invoice dropzone writes it; project-outcome, the /reports margin drawer, the
-- Watch list, the shop report and the weekly snapshot all read it as material
-- spend). Andrew's call 2026-10-29: EXTEND it, don't fork it — one ledger, and
-- every existing reader stays wired. It has 0 rows on prod, so nothing moves.
--
-- Not to be confused with `client_invoices` (041) — the bills the SHOP sends.
--
-- Adds:
--   source      'parsed' (the dropzone) | 'manual' (the row form)
--   note        free text
--   entered_by  who created it
--   edited_by / edited_at   the time-entry pattern: last edit, stamped
--   updated_at
-- (`file_url` already exists — the upload ref.)
--
-- RLS: `invoices` predates the repo's migrations and no migration ever set a
-- policy on it. This adds the standard org-scoped FOR ALL policy (the
-- project_payments 099 shape) on it and its line items. Permissive policies
-- OR together, so if a policy already exists this can only ever match the
-- caller's own org — it never widens past it.
--
-- Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'parsed';
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS note text NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS entered_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS edited_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS edited_at timestamptz NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_source_check') THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_source_check CHECK (source IN ('parsed', 'manual'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_invoices_project ON public.invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_org ON public.invoices(org_id);

COMMENT ON TABLE public.invoices IS
  'VENDOR bills against a project — the material-spend ledger (124). Parsed by '
  'the invoice dropzone or entered by hand. Read as actual material spend by '
  'the project P&L, project-outcome, /reports and the /pm Watch list. Not the '
  'shop''s own bills to clients — those are client_invoices.';
COMMENT ON COLUMN public.invoices.source IS
  '''parsed'' = read from an uploaded bill; ''manual'' = typed in. (124)';

-- ── RLS ──
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_own_org ON public.invoices;
CREATE POLICY invoices_own_org ON public.invoices
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_line_items_own_org ON public.invoice_line_items;
CREATE POLICY invoice_line_items_own_org ON public.invoice_line_items
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

COMMIT;

NOTIFY pgrst, 'reload schema';
