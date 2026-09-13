-- ============================================================================
-- 102 — supply_items  (the "where do we buy this" directory)
-- ============================================================================
-- Andrew, 2026-09-12: "some things we only buy every few months and we have to
-- dig around to figure out where to get it. Keep it simple for now, filters
-- later."
--
-- That's the whole feature: a shop address book for things bought rarely
-- enough that nobody remembers the source. PSA sandpaper rolls, a specific
-- drawer slide, the place that does the odd glass insert.
--
-- ⛔ THIS IS NOT A CATALOG, AND MUST NOT QUIETLY BECOME ONE. The rate book
-- (`materials`, `rate_book_items`) already holds everything that PRICES a job,
-- with calibrations behind it. Nothing here feeds pricing — no cost, no unit,
-- no markup, on purpose. The moment a price column lands here, two tables
-- describe the same material and they start disagreeing. If a supply needs a
-- price, it belongs in the rate book instead.
--
-- ⚠️ NO CATEGORY COLUMN, DELIBERATELY (Andrew: "filters later"). A category
-- added now would be guessed, then lived with. The page searches every text
-- field instead, which is enough at this size and costs nothing to replace.
--
-- `vendor_info` is FREEFORM on purpose — phone, rep's name, account number,
-- "ask for Dave", minimum order. Splitting it into columns would force a
-- shape onto notes that are genuinely unstructured, and most rows will have
-- one or two of them at most.
--
-- Idempotent. RLS follows the `projects`/`tasks` FOR-ALL org pattern (083/093):
-- ⛔ every full-app role can add and edit, deliberately — Kaylin does the
-- ordering, and a directory only the owner can maintain is a directory that
-- goes stale.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.supply_items;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.supply_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  name         text NOT NULL,
  -- Where to buy it. Nullable: plenty of suppliers are a phone call.
  -- ⛔ Rendered as a link, so it is an XSS surface — the app runs it through
  -- the allowlist in lib/task-links (http/https only) before making an
  -- anchor. Never render this href raw.
  url          text NULL,
  vendor       text NULL,
  -- Phone / rep / account number / minimum order. Freeform; see the header.
  vendor_info  text NULL,
  notes        text NULL,
  -- Archive rather than delete: a supply that's been ordered from before is
  -- history worth keeping, and a row nobody can see is easier to restore than
  -- one that's gone.
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- The only query the page makes: this org's rows, newest-relevant first.
CREATE INDEX IF NOT EXISTS idx_supply_items_org
  ON public.supply_items(org_id, active);

COMMENT ON TABLE public.supply_items IS
  'Where to buy rarely-ordered shop supplies. NOT a priced catalog — the rate book owns anything that prices a job.';
COMMENT ON COLUMN public.supply_items.vendor_info IS
  'Freeform: phone, rep, account number, minimum order. Deliberately not split into columns.';

-- ── RLS ──
ALTER TABLE public.supply_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supply_items_own_org ON public.supply_items;
CREATE POLICY supply_items_own_org ON public.supply_items
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

COMMIT;

NOTIFY pgrst, 'reload schema';
