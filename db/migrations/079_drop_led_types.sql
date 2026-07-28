-- ============================================================================
-- 079 — Drop led_types (superseded by cabinet_features)
-- ============================================================================
-- Migration 078 created cabinet_features and copied every LED type in as
-- mode='runs'. The composer now reads cabinet_features exclusively (chunk F2)
-- and lib/led.ts is deleted, so led_types is unreferenced.
--
-- Run AFTER 078 (which does the data copy). Idempotent.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS public.led_types;

COMMIT;

NOTIFY pgrst, 'reload schema';
