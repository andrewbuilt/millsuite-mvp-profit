-- ============================================================================
-- 113 — co_docs.show_line_detail  (client-facing CO documents, sales+CO batch)
-- ============================================================================
-- Andrew's Bonzer_Draft_CO.pdf showed the problem: added-scope items print raw
-- composer slot summaries ("Wall Panels (Square Foot) · 3/4" Shinnoki Standard
-- 1S · 45 sqft") — shop internals on a client document.
--
-- The fix is two halves. The editable client-facing description per ITEM needs
-- no schema change (`co_doc_items.description` has existed since 107 — the UI
-- just never offered it). This migration is the other half: whether the PDF
-- prints the material/qty detail rows at all, PER DOC.
--
-- DEFAULT false = detail HIDDEN. That is the deliberate flip: the detail rows
-- are the complaint, so they become opt-in ("show line detail" for the GC who
-- wants them) instead of opt-out. Existing ACCEPTED docs are unaffected — their
-- pdf_url is an immutable snapshot the route returns without re-rendering (107
-- rule). Open docs pick the clean default up on their next PDF render, which
-- is exactly the Bonzer fix.
--
-- Idempotent. No RLS change — co_docs already carries its policies (107).
-- ============================================================================

BEGIN;

ALTER TABLE public.co_docs
  ADD COLUMN IF NOT EXISTS show_line_detail boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.co_docs.show_line_detail IS
  'Whether this doc''s PDF prints per-line material/qty detail rows under each '
  'item. Default false: client documents lead with the edited client-facing '
  'description; detail is opt-in per doc (a GC asking for backup). See 113.';

COMMIT;

NOTIFY pgrst, 'reload schema';
