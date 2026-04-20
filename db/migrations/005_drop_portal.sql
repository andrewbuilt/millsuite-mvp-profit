-- ============================================================================
-- Migration 005 — drop client-portal scaffolding
-- ============================================================================
-- Phase 0 foundation cleanup (per BUILD-ORDER.md + SYSTEM-MAP.md).
--
-- The client portal was Apr-18 scope creep from a prior thread. MillSuite's
-- new architecture does NOT expose a client-facing portal. Instead, finish
-- specs + drawings are approved internally (Phase 6 approval cards), and QB
-- is watched-not-pushed-to for payment events (Phase 9).
--
-- This migration drops:
--   - projects.portal_slug, portal_password_hash, portal_step columns
--   - portal_timeline table
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

-- 1. Drop the portal columns on projects.
ALTER TABLE projects DROP COLUMN IF EXISTS portal_slug;
ALTER TABLE projects DROP COLUMN IF EXISTS portal_password_hash;
ALTER TABLE projects DROP COLUMN IF EXISTS portal_step;

-- 2. Drop the portal timeline table entirely.
DROP TABLE IF EXISTS portal_timeline CASCADE;

COMMIT;
