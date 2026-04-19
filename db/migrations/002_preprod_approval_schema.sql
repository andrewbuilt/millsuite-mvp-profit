-- ============================================================================
-- MillSuite — Pre-production approval system (Phase 0 schema)
-- ============================================================================
-- Implements the schema for the post-sold material + finish approval surface,
-- derived from /mnt/code/built-os/preprod-approval-mockup.html and the 10
-- design decisions in BUILD-PLAN.md Section 2 (D1-D10).
--
-- Drops the Apr 18 Built-OS-clone tables (selections, selection_history,
-- spec_library_items, finish_samples, drawing_revisions, change_orders) and
-- replaces them with the simplified approval model.
--
-- Safe to run once via Supabase SQL editor. Uses DROP IF EXISTS + CREATE IF
-- NOT EXISTS so it works whether or not 001 was applied.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop the Apr 18 Built-OS-clone tables being replaced.
-- ---------------------------------------------------------------------------
-- STATE.md flagged these as the Apr 18 misread: Built OS's schema cloned into
-- this repo instead of building from the mockups. All data is demo data per
-- Andrew, so CASCADE is safe.

DROP TABLE IF EXISTS selection_history CASCADE;
DROP TABLE IF EXISTS selections CASCADE;
DROP TABLE IF EXISTS spec_library_items CASCADE;
DROP TABLE IF EXISTS finish_samples CASCADE;
DROP TABLE IF EXISTS change_orders CASCADE;
DROP TABLE IF EXISTS drawing_revisions CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Shared enums
-- ---------------------------------------------------------------------------
-- CREATE TYPE has no IF NOT EXISTS — use DO blocks for idempotency.

DO $$ BEGIN
  CREATE TYPE approval_state AS ENUM ('pending', 'in_review', 'approved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ball_in_court_party AS ENUM ('client', 'shop', 'vendor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE item_revision_action AS ENUM (
    'submitted',
    'client_requested_change',
    'approved',
    'material_changed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE co_state AS ENUM ('draft', 'sent_to_client', 'approved', 'rejected', 'void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE qb_handoff_state AS ENUM (
    'not_yet',
    'separate_invoice',
    'invoice_edited',
    'not_applicable'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 3. rate_book_items — first-class construction items
-- ---------------------------------------------------------------------------
-- Per STATE.md: "items as first-class objects with per-department labor hours
-- embedded, sheets + sheet cost + hardware on the item, options layer, history
-- audit, jobs list." This is what the Apr 18 scaffolding missed.

CREATE TABLE IF NOT EXISTS rate_book_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  category_id uuid REFERENCES rate_book_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  unit text DEFAULT 'lf' CHECK (unit IN ('lf', 'each', 'sf')),
  -- Per-department base labor hours for the construction. Variant multipliers
  -- scale these; material swaps don't change construction time unless the
  -- variant says so.
  base_labor_hours_eng numeric DEFAULT 0,
  base_labor_hours_cnc numeric DEFAULT 0,
  base_labor_hours_assembly numeric DEFAULT 0,
  base_labor_hours_finish numeric DEFAULT 0,
  base_labor_hours_install numeric DEFAULT 0,
  -- Physical inputs from the rate book mockup.
  sheets_per_unit numeric DEFAULT 0,
  sheet_cost numeric DEFAULT 0,
  hardware_cost numeric DEFAULT 0,
  -- D1: default callouts that become approval_items labels when a line uses
  -- this item. Estimate lines can override per-line via their own callouts[].
  default_callouts text[] NOT NULL DEFAULT '{}',
  -- D2: pointer to the default material variant. FK added after variants
  -- table exists (circular reference).
  default_variant_id uuid,
  -- Confidence metadata (matches existing rate_book_categories pattern).
  confidence_job_count integer DEFAULT 0,
  confidence_last_used_at timestamptz,
  active boolean DEFAULT true,
  notes text
);
CREATE INDEX IF NOT EXISTS idx_rate_book_items_org ON rate_book_items(org_id);
CREATE INDEX IF NOT EXISTS idx_rate_book_items_category ON rate_book_items(category_id);

-- ---------------------------------------------------------------------------
-- 4. rate_book_material_variants — per-item material options (D2)
-- ---------------------------------------------------------------------------
-- Construction stays constant on the item; material swaps here. A CO that
-- changes material reads original_variant_id + proposed_variant_id and diffs.

CREATE TABLE IF NOT EXISTS rate_book_material_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  rate_book_item_id uuid NOT NULL REFERENCES rate_book_items(id) ON DELETE CASCADE,
  material_name text NOT NULL,
  material_cost_per_lf numeric DEFAULT 0,
  -- Per-department multipliers, default 1.0. Chevron-matched veneer adds
  -- engineering via labor_multiplier_eng > 1.0; most swaps leave these at 1.0.
  labor_multiplier_eng numeric DEFAULT 1.0,
  labor_multiplier_cnc numeric DEFAULT 1.0,
  labor_multiplier_assembly numeric DEFAULT 1.0,
  labor_multiplier_finish numeric DEFAULT 1.0,
  labor_multiplier_install numeric DEFAULT 1.0,
  active boolean DEFAULT true,
  notes text
);
CREATE INDEX IF NOT EXISTS idx_rate_book_material_variants_item
  ON rate_book_material_variants(rate_book_item_id);

-- Circular FK: rate_book_items.default_variant_id → rate_book_material_variants.id.
-- Added here now that both tables exist.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rate_book_items_default_variant_fk'
  ) THEN
    ALTER TABLE rate_book_items
      ADD CONSTRAINT rate_book_items_default_variant_fk
      FOREIGN KEY (default_variant_id)
      REFERENCES rate_book_material_variants(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. estimate_lines — per-subproject priced line items (D1, D2)
-- ---------------------------------------------------------------------------
-- Promotes estimate lines from subprojects.{pricing,spec,assembly}_lines_json
-- blobs (Apr 18 scaffolding, never read by UI) to first-class rows. The
-- subproject-editor mockup treats lines as first-class and approval_items
-- needs an FK target for source_estimate_line_id.

CREATE TABLE IF NOT EXISTS estimate_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  subproject_id uuid NOT NULL REFERENCES subprojects(id) ON DELETE CASCADE,
  sort_order integer DEFAULT 0,
  description text NOT NULL,
  rate_book_item_id uuid REFERENCES rate_book_items(id) ON DELETE SET NULL,
  rate_book_material_variant_id uuid REFERENCES rate_book_material_variants(id) ON DELETE SET NULL,
  quantity numeric DEFAULT 1,
  linear_feet numeric,
  -- D1: null = inherit rate_book_items.default_callouts; non-null overrides.
  callouts text[],
  -- Denormalized price override when the line diverges from computed price.
  unit_price_override numeric,
  notes text
);
CREATE INDEX IF NOT EXISTS idx_estimate_lines_subproject ON estimate_lines(subproject_id);
CREATE INDEX IF NOT EXISTS idx_estimate_lines_item ON estimate_lines(rate_book_item_id);

-- ---------------------------------------------------------------------------
-- 6. approval_items — pre-prod spec slots (D1, D4, D5, D7)
-- ---------------------------------------------------------------------------
-- One row per spec slot per subproject. Created when a subproject is marked
-- sold, from estimate_lines.callouts (or rate_book_items.default_callouts if
-- line-level callouts is null).

CREATE TABLE IF NOT EXISTS approval_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  subproject_id uuid NOT NULL REFERENCES subprojects(id) ON DELETE CASCADE,
  source_estimate_line_id uuid REFERENCES estimate_lines(id) ON DELETE SET NULL,
  label text NOT NULL,  -- the callout string that became this slot
  rate_book_item_id uuid REFERENCES rate_book_items(id) ON DELETE SET NULL,
  rate_book_material_variant_id uuid REFERENCES rate_book_material_variants(id) ON DELETE SET NULL,
  material text,  -- denormalized for display + history
  finish text,
  is_custom boolean DEFAULT false,
  -- D7: custom-slot baseline. Used for CO diff when rate book doesn't apply.
  -- If all null on a custom slot, the CO panel won't auto-reprice.
  custom_material_cost_per_lf numeric,
  custom_labor_hours_eng numeric,
  custom_labor_hours_cnc numeric,
  custom_labor_hours_assembly numeric,
  custom_labor_hours_finish numeric,
  custom_labor_hours_install numeric,
  -- D4: self-FK for linked slots. Non-null means this slot inherits from the
  -- target; approval on the target propagates here.
  linked_to_item_id uuid REFERENCES approval_items(id) ON DELETE SET NULL,
  state approval_state NOT NULL DEFAULT 'pending',
  last_state_change_at timestamptz DEFAULT now(),
  -- D5: stored (not computed) so the ball-in-court chip query stays cheap.
  ball_in_court ball_in_court_party
);
CREATE INDEX IF NOT EXISTS idx_approval_items_subproject ON approval_items(subproject_id);
CREATE INDEX IF NOT EXISTS idx_approval_items_state ON approval_items(subproject_id, state);
CREATE INDEX IF NOT EXISTS idx_approval_items_linked ON approval_items(linked_to_item_id)
  WHERE linked_to_item_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. item_revisions — audit trail of sample submissions + responses
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS item_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_item_id uuid NOT NULL REFERENCES approval_items(id) ON DELETE CASCADE,
  action item_revision_action NOT NULL,
  note text,
  actor_user_id uuid,
  occurred_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_item_revisions_item
  ON item_revisions(approval_item_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- 8. drawing_revisions — parallel drawing approval track (D8)
-- ---------------------------------------------------------------------------
-- One row per revision (no parent "drawings" entity per D8). is_latest is
-- stored and flipped when a new revision uploads — cheaper for the gate
-- query than computing MAX(revision_number) per subproject.

CREATE TABLE IF NOT EXISTS drawing_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  subproject_id uuid NOT NULL REFERENCES subprojects(id) ON DELETE CASCADE,
  revision_number integer NOT NULL,
  file_url text,
  state approval_state NOT NULL DEFAULT 'pending',
  is_latest boolean NOT NULL DEFAULT true,
  uploaded_by_user_id uuid,
  submitted_at timestamptz DEFAULT now(),
  responded_at timestamptz,
  notes text,
  UNIQUE (subproject_id, revision_number)
);
CREATE INDEX IF NOT EXISTS idx_drawing_revisions_subproject ON drawing_revisions(subproject_id);
CREATE INDEX IF NOT EXISTS idx_drawing_revisions_latest ON drawing_revisions(subproject_id)
  WHERE is_latest = true;

-- ---------------------------------------------------------------------------
-- 9. change_orders — CO as estimate-line diff (D3, D10)
-- ---------------------------------------------------------------------------
-- V1 is manual throughout: no QB API call, no auto-email, no portal signing.
-- Shop user captures the client's verbal/email approval and the QB handoff
-- method by hand.

CREATE TABLE IF NOT EXISTS change_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subproject_id uuid REFERENCES subprojects(id) ON DELETE SET NULL,
  approval_item_id uuid REFERENCES approval_items(id) ON DELETE SET NULL,
  title text NOT NULL,
  -- Frozen copies. original_line_snapshot captures the line state when the CO
  -- was drafted, even if the line is later edited for other reasons.
  original_line_snapshot jsonb NOT NULL,
  proposed_line jsonb NOT NULL,
  net_change numeric DEFAULT 0,
  no_price_change boolean DEFAULT false,
  state co_state NOT NULL DEFAULT 'draft',
  client_response_note text,
  -- D3: default is separate_invoice; user can toggle per CO.
  qb_handoff_state qb_handoff_state NOT NULL DEFAULT 'not_yet',
  qb_handoff_note text
);
CREATE INDEX IF NOT EXISTS idx_change_orders_project ON change_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_change_orders_subproject ON change_orders(subproject_id);
CREATE INDEX IF NOT EXISTS idx_change_orders_state ON change_orders(project_id, state);

-- ---------------------------------------------------------------------------
-- 10. Scheduling gate view (D8, D10 math)
-- ---------------------------------------------------------------------------
-- A subproject is ready_for_scheduling when every approval_item is approved
-- and every latest drawing revision is approved. Exposed as a view so the
-- project dashboard + scheduling page can select it cheaply.

CREATE OR REPLACE VIEW subproject_approval_status AS
SELECT
  s.id AS subproject_id,
  (
    -- All slots approved (zero unapproved).
    COALESCE((
      SELECT count(*) FROM approval_items ai
      WHERE ai.subproject_id = s.id AND ai.state != 'approved'
    ), 0) = 0
    AND
    -- At least one latest drawing revision exists (can't schedule a subproject
    -- that never had drawings uploaded).
    COALESCE((
      SELECT count(*) FROM drawing_revisions dr
      WHERE dr.subproject_id = s.id AND dr.is_latest = true
    ), 0) > 0
    AND
    -- All latest drawings approved (zero unapproved).
    COALESCE((
      SELECT count(*) FROM drawing_revisions dr
      WHERE dr.subproject_id = s.id AND dr.is_latest = true AND dr.state != 'approved'
    ), 0) = 0
  ) AS ready_for_scheduling,
  (SELECT count(*) FROM approval_items ai WHERE ai.subproject_id = s.id) AS slots_total,
  (SELECT count(*) FROM approval_items ai WHERE ai.subproject_id = s.id AND ai.state = 'approved') AS slots_approved,
  (SELECT count(*) FROM drawing_revisions dr WHERE dr.subproject_id = s.id AND dr.is_latest = true) AS latest_drawing_revisions,
  (SELECT count(*) FROM drawing_revisions dr WHERE dr.subproject_id = s.id AND dr.is_latest = true AND dr.state = 'approved') AS latest_drawings_approved,
  (SELECT count(*) FROM change_orders co WHERE co.subproject_id = s.id AND co.state NOT IN ('approved', 'rejected', 'void')) AS open_change_orders,
  COALESCE((
    SELECT sum(co.net_change) FROM change_orders co
    WHERE co.subproject_id = s.id AND co.state = 'approved'
  ), 0) AS approved_co_net_change
FROM subprojects s;

-- ============================================================================
-- DONE.
--   Tables dropped: selections, selection_history, spec_library_items,
--     finish_samples, change_orders (Apr 18 shape), drawing_revisions (Apr 18 shape)
--   Tables created: rate_book_items, rate_book_material_variants,
--     estimate_lines, approval_items, item_revisions, drawing_revisions (new),
--     change_orders (new)
--   Enums created: approval_state, ball_in_court_party, item_revision_action,
--     co_state, qb_handoff_state
--   View created: subproject_approval_status
-- ============================================================================
