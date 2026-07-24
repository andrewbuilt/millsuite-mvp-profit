-- ============================================================================
-- 076 — Allow 'custom' as an estimate_lines.product_key (chunk E)
-- ============================================================================
-- Custom products (075) save composer lines with product_key='custom'. The
-- check constraint from migration 020 only allowed the built-in keys, so the
-- insert failed ("violates check constraint estimate_lines_product_key_check").
-- Add 'custom'. Idempotent (drop + re-add).
-- ============================================================================

BEGIN;

ALTER TABLE public.estimate_lines
  DROP CONSTRAINT IF EXISTS estimate_lines_product_key_check;
ALTER TABLE public.estimate_lines
  ADD CONSTRAINT estimate_lines_product_key_check
    CHECK (product_key IS NULL OR product_key IN (
      'base', 'upper', 'full', 'drawer', 'led', 'countertop', 'custom'
    ));

COMMIT;

NOTIFY pgrst, 'reload schema';
