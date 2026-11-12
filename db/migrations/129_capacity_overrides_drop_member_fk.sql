-- ============================================================================
-- 129 — drop capacity_overrides.team_member_id → users FK (2026-11-12)
-- ============================================================================
-- ⛔ THE PTO-APPROVE BUG (broken for EVERYONE, owner included; Built had never
-- approved a single request). Prod carries a foreign key that no migration in
-- this repo creates — `capacity_overrides_team_member_id_fkey`, team_member_id
-- → public.users(id) — left over from the pre-migration schema. But
-- team_member_id holds the ROSTER id (orgs.team_members[].id, jsonb), exactly
-- like pto_requests.team_member_id (062 has no FK there, by design). So every
-- approve's insert failed with 23503:
--   Key (team_member_id)=(…) is not present in table "users"
-- The banner said only "Could not approve that request." because the UI
-- dropped non-Error throws (fixed alongside: lib/error-text).
--
-- A jsonb roster id can't be FK'd, so the constraint goes. Holidays (NULL
-- member) were never affected — that's why they always worked.
-- Probe: `npx tsx scripts/verify-pto-approve-live.mjs` (inserts + deletes one
-- 2099 row with the service key; must print PASS).
--
-- Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.capacity_overrides
  DROP CONSTRAINT IF EXISTS capacity_overrides_team_member_id_fkey;

COMMIT;

NOTIFY pgrst, 'reload schema';
