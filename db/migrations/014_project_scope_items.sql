-- ============================================================================
-- Migration 014 — project_scope_items (parsed BOM source of truth)
-- ============================================================================
-- When /api/parse-drawings returns structured scope items (rich shape with
-- features / material_specs / hardware_specs / finish_specs) we persist them
-- here. The BOM / takeoff page reads this table and aggregates it into sheet
-- counts, hardware counts, and finish sq ft.
--
-- Mirrors takeoff.takeoff_items but scoped to a project (MVP) rather than a
-- standalone takeoff project. subproject_id is nullable — the sales flow
-- creates one subproject per room and then links scope items by matching
-- room name; items without a confident room match stay project-scoped until
-- a user moves them.
--
-- This table is the single source of truth for parsed BOM data. Before this
-- migration the parser returned items in the API response but they were
-- never persisted — sheet quantities couldn't be displayed because there was
-- nothing to read.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS project_scope_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subproject_id uuid REFERENCES subprojects(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,

  -- Identity
  name text NOT NULL,
  room text,
  category text
    CHECK (category IN (
      'base_cabinet', 'upper_cabinet', 'full_height', 'vanity',
      'drawer_box', 'countertop', 'panel', 'scribe',
      'led', 'hardware', 'custom', 'other'
    )),
  item_type text,
  quality text
    CHECK (quality IN ('standard', 'premium', 'custom', 'unspecified')),

  -- Scale
  linear_feet numeric,
  quantity integer NOT NULL DEFAULT 1,

  -- Rich specs (jsonb, normalized in /api/parse-drawings before insert)
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  material_specs jsonb NOT NULL DEFAULT '{}'::jsonb,
  hardware_specs jsonb NOT NULL DEFAULT '{}'::jsonb,
  finish_specs jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Provenance
  parser_confidence numeric CHECK (parser_confidence IS NULL OR (parser_confidence >= 0 AND parser_confidence <= 1)),
  needs_review boolean NOT NULL DEFAULT false,
  source_sheet text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scope_items_project
  ON project_scope_items(project_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_scope_items_subproject
  ON project_scope_items(subproject_id);

CREATE INDEX IF NOT EXISTS idx_scope_items_org
  ON project_scope_items(org_id);

-- Auto-update updated_at on row changes. Reuses the trigger function pattern
-- from earlier migrations if it exists; creates it here otherwise.
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_scope_items_updated_at ON project_scope_items;
CREATE TRIGGER trg_project_scope_items_updated_at
  BEFORE UPDATE ON project_scope_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();

-- NOTE: Following the MVP's existing pattern, we do NOT enable RLS on this
-- table. Every MVP app table (subprojects, estimate_lines, etc.) relies on
-- app-level org filtering — callers always pass org_id through the supabase
-- client. See lib/sales.ts and lib/estimate-lines.ts for the pattern.

COMMIT;
