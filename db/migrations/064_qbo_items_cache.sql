-- ============================================================================
-- 064 — QuickBooks item cache (subproject → QB service-item mapping)
-- ============================================================================
-- 6a-2 (subproject parity + QB mapping). Ports Built OS's qbo_items_cache so
-- an invoice push maps each subproject's activity_type to a real QuickBooks
-- service/non-inventory Item (ItemRef), instead of dumping everything on the
-- generic "Services" item.
--
-- MillSuite is multi-org (unlike Built's single-tenant cache), so the cache is
-- org-scoped: (org_id, qb_id) unique. A sync action (POST /api/qb/sync-items)
-- pulls the org's active Service + NonInventory items from QB and upserts them
-- here; the push does a strict, normalized name match against this table and
-- 422s ("sync your QB items") on a miss rather than silently inventing items.
--
-- Writes happen only via the service-role sync route (bypasses RLS); org
-- members get read-only, org-scoped access (the activity-type dropdown reads
-- it). Idempotent (IF NOT EXISTS). Run against prod Supabase before deploying
-- the code that reads/writes it.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.qbo_items_cache (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  qb_id              text NOT NULL,     -- QuickBooks Item Id
  name               text,             -- QB Item Name (matched against subproject.activity_type)
  description        text,
  type               text,             -- 'Service' | 'NonInventory' | …
  income_account_id  text,
  unit_price         numeric,
  active             boolean NOT NULL DEFAULT true,
  synced_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, qb_id)
);

CREATE INDEX IF NOT EXISTS idx_qbo_items_cache_org
  ON public.qbo_items_cache(org_id, active);

ALTER TABLE public.qbo_items_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qbo_items_cache_select ON public.qbo_items_cache;
CREATE POLICY qbo_items_cache_select ON public.qbo_items_cache FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.org_id = qbo_items_cache.org_id AND u.auth_user_id = auth.uid()
  ));
-- No write policy: only the service-role sync route writes here.

NOTIFY pgrst, 'reload schema';

COMMIT;
