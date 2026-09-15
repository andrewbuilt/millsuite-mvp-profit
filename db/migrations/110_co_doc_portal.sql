-- ============================================================================
-- 110 — a change order document can be SENT to the client, and signed there
-- ============================================================================
-- ⛔ `sent_at` IS A SAFETY GATE, NOT BOOKKEEPING.
--
-- A v2 doc's statuses are open | accepted | void. "Open" means the shop is
-- still composing it — drafts appear and disappear, prices move, an abandoned
-- click leaves an empty one. Showing every open doc in the client portal would
-- show the client the shop thinking out loud, and invite them to sign a
-- document that is still being written.
--
-- v1 had this gate as a STATE (`change_orders.state = 'sent_to_client'`) and
-- the portal keys off it. v2 keeps status for the lifecycle and records the
-- send as a timestamp, so the portal's rule is "sent, not yet accepted".
--
-- `signed_ip` is evidence, matching what 092 gave `change_orders`. It is not a
-- gate: it's absent locally and present behind Vercel, and a signature is no
-- less real for having been made through a proxy.
--
-- `signed_pdf_url` is DISTINCT FROM `pdf_url` on purpose. 107's `pdf_url` is
-- the snapshot of the document as accepted; this is the COUNTERSIGNED copy
-- with the client's name on it. v1 learned this the hard way — writing the
-- countersigned copy over the same path destroys the blank-signature PDF the
-- shop may already have emailed.
--
-- ROLLBACK:
--   ALTER TABLE public.co_docs
--     DROP COLUMN IF EXISTS sent_at,
--     DROP COLUMN IF EXISTS signed_ip,
--     DROP COLUMN IF EXISTS signed_pdf_url;
-- ============================================================================

BEGIN;

ALTER TABLE public.co_docs
  ADD COLUMN IF NOT EXISTS sent_at        timestamptz NULL,
  ADD COLUMN IF NOT EXISTS signed_ip      text NULL,
  ADD COLUMN IF NOT EXISTS signed_pdf_url text NULL;

COMMENT ON COLUMN public.co_docs.sent_at IS
  'When the shop sent this doc to the client. NULL = still being composed; the portal must not show it.';
COMMENT ON COLUMN public.co_docs.signed_pdf_url IS
  'The COUNTERSIGNED copy. Separate from pdf_url so signing cannot overwrite the blank-signature PDF already sent.';

COMMIT;

NOTIFY pgrst, 'reload schema';
