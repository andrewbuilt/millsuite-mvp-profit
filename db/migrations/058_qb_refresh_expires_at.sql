-- ============================================================================
-- 058 — QuickBooks per-org tokens: add refresh_expires_at
-- ============================================================================
-- qb_connections (migration 010) already stores per-org QB OAuth state:
-- realm_id, access_token, refresh_token, expires_at, scope. The one thing it
-- doesn't track is the REFRESH token's own lifetime — Intuit returns this
-- (x_refresh_token_expires_in, ~100 days). We store it so we can tell when a
-- connection has to be re-authorized (refresh tokens expire even if unused),
-- instead of silently failing on the next push.
--
-- This is Chunk 2 of the invoicing-backend work (real QB OAuth + per-org token
-- storage). The connect/refresh code in lib/quickbooks.ts writes this column.
--
-- Idempotent: safe to re-run.
--
-- Rollback:
--   ALTER TABLE public.qb_connections DROP COLUMN IF EXISTS refresh_expires_at;
-- ============================================================================

BEGIN;

ALTER TABLE public.qb_connections
  ADD COLUMN IF NOT EXISTS refresh_expires_at timestamptz NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
