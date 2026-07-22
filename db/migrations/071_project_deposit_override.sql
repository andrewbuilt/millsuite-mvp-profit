-- ============================================================================
-- 071 — projects.deposit_override (QB-mode readiness failsafe)
-- ============================================================================
-- In QB mode the system never creates internal invoices; the deposit signal
-- comes from the QB watcher marking the contract invoice paid. This flag is the
-- rare manual override — "payment is forthcoming / the QB connection is messed
-- up, push the project forward" — that lets isReadyForProduction pass without a
-- recorded deposit. Idempotent. Run against prod before deploying.
-- ============================================================================

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS deposit_override boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';

COMMIT;
