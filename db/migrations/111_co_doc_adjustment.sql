-- ============================================================================
-- 111 — a change order can just be an AMOUNT
-- ============================================================================
-- ⛔ THE GAP, MEASURED. Andrew: "how can I just deduct an amount? for the
-- imported jobs there isn't anything to modify on the subproject level."
--
-- He's right, and it's total. `scripts/inspect-co-cutover` reports **91 frozen
-- subprojects, and all 91 have ONE estimate line or none** — because the Built
-- importer writes each migrated room as a single lump. So on every imported
-- job the v2 revise flow offers exactly one move: remove the only line, which
-- removes the whole scope. "Take $1,500 off" had no representation at all.
--
-- That is also just how a change order reads on paper. Half the lines on a
-- real one are a sentence and a number — "Credit: client supplying own
-- hardware … (1,850)" — with no line-item model behind them.
--
-- So: a fourth item kind that carries a DESCRIPTION and an AMOUNT and nothing
-- else. No subproject, no draft payload, no composer.
--
-- ⚠️ `subproject_id` stays NULL for these, which the partial unique index
-- `uniq_co_doc_items_sub` already tolerates — so a doc can hold several
-- adjustments, which is what you want (a credit and a charge on one CO).
--
-- ROLLBACK (only if no adjustment rows exist):
--   ALTER TABLE public.co_doc_items DROP CONSTRAINT co_doc_items_kind_check;
--   ALTER TABLE public.co_doc_items ADD CONSTRAINT co_doc_items_kind_check
--     CHECK (kind IN ('add_sub', 'edit_sub', 'remove_sub'));
-- ============================================================================

BEGIN;

ALTER TABLE public.co_doc_items
  DROP CONSTRAINT IF EXISTS co_doc_items_kind_check;

ALTER TABLE public.co_doc_items
  ADD CONSTRAINT co_doc_items_kind_check
  CHECK (kind IN ('add_sub', 'edit_sub', 'remove_sub', 'adjustment'));

COMMENT ON COLUMN public.co_doc_items.kind IS
  'add_sub | edit_sub | remove_sub | adjustment. An adjustment is a described amount with no scope model behind it — the only thing that works on an imported job, where every subproject is a single frozen lump.';

COMMIT;

NOTIFY pgrst, 'reload schema';
