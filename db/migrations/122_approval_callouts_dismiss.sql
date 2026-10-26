-- ============================================================================
-- 122 — Pre-production approval callouts: add / edit / DELETE (2026-10-26)
-- ============================================================================
-- Imported jobs had nothing to approve (slots derive from composer lines
-- only), so callouts can now be added, edited and deleted by hand on the
-- pre-production page (manual ones use the existing is_custom flag).
--
-- ⛔ DELETE IS A TOMBSTONE, NOT A DELETE.
--   1. Approval history is retained (Andrew's spec) — an approved callout
--      that's removed still says who approved what, and when.
--   2. The self-healing re-seed (lib/approvals createApprovalItemsFromProposals)
--      de-dupes proposals against EXISTING rows by (sub, label, material,
--      finish) and (sub, label, source line). A hard DELETE took the de-dup
--      key with it, so the next pre-production load re-proposed the very
--      callout someone just deleted (the question deferred on 2026-09-23).
--      A dismissed row keeps its key; the re-seed reads dismissed rows on
--      purpose, every other reader filters them out.
--
--   approval_items.dismissed_at / dismissed_by — non-null = deleted.
--   subproject_approval_status — recreated to ignore dismissed callouts in
--   the gate and the counts (column list unchanged; security_invoker kept,
--   083's tenant-isolation setting).
--
-- Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.approval_items
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz NULL;

ALTER TABLE public.approval_items
  ADD COLUMN IF NOT EXISTS dismissed_by uuid NULL;

COMMENT ON COLUMN public.approval_items.dismissed_at IS
  'Non-null = deleted from the pre-production list (a tombstone: keeps history and the re-seed de-dup key). (122)';

CREATE OR REPLACE VIEW public.subproject_approval_status
WITH (security_invoker = true) AS
SELECT
  s.id AS subproject_id,
  (
    COALESCE((
      SELECT count(*) FROM public.approval_items ai
      WHERE ai.subproject_id = s.id AND ai.dismissed_at IS NULL AND ai.state != 'approved'
    ), 0) = 0
    AND
    COALESCE((
      SELECT count(*) FROM public.drawing_revisions dr
      WHERE dr.subproject_id = s.id AND dr.is_latest = true
    ), 0) > 0
    AND
    COALESCE((
      SELECT count(*) FROM public.drawing_revisions dr
      WHERE dr.subproject_id = s.id AND dr.is_latest = true AND dr.state != 'approved'
    ), 0) = 0
  ) AS ready_for_scheduling,
  (SELECT count(*) FROM public.approval_items ai WHERE ai.subproject_id = s.id AND ai.dismissed_at IS NULL) AS slots_total,
  (SELECT count(*) FROM public.approval_items ai WHERE ai.subproject_id = s.id AND ai.dismissed_at IS NULL AND ai.state = 'approved') AS slots_approved,
  (SELECT count(*) FROM public.drawing_revisions dr WHERE dr.subproject_id = s.id AND dr.is_latest = true) AS latest_drawing_revisions,
  (SELECT count(*) FROM public.drawing_revisions dr WHERE dr.subproject_id = s.id AND dr.is_latest = true AND dr.state = 'approved') AS latest_drawings_approved,
  (SELECT count(*) FROM public.change_orders co WHERE co.subproject_id = s.id AND co.state NOT IN ('approved', 'rejected', 'void')) AS open_change_orders,
  COALESCE((
    SELECT sum(co.net_change) FROM public.change_orders co
    WHERE co.subproject_id = s.id AND co.state = 'approved'
  ), 0) AS approved_co_net_change
FROM public.subprojects s;

COMMIT;

NOTIFY pgrst, 'reload schema';
