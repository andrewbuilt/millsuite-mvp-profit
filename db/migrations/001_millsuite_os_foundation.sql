-- ============================================================================
-- MillSuite OS — Foundation migration (Day 1)
-- ============================================================================
-- Builds the complete platform schema on top of the existing Profit MVP tables.
-- Starter tier uses a subset; Pro/Pro+AI unlock additional surfaces.
-- Run once via Supabase SQL editor. Idempotent (CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. EXTEND projects TABLE (Pro tier fields, nullable for Starter)
-- ---------------------------------------------------------------------------

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS production_phase text
    CHECK (production_phase IN ('pre_production', 'scheduling', 'in_production')),
  ADD COLUMN IF NOT EXISTS source_lead_id uuid,
  ADD COLUMN IF NOT EXISTS client_id uuid,
  ADD COLUMN IF NOT EXISTS contact_id uuid,
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS estimated_price numeric,
  ADD COLUMN IF NOT EXISTS estimated_hours numeric,
  ADD COLUMN IF NOT EXISTS locked_shop_rate numeric,
  ADD COLUMN IF NOT EXISTS payment_terms jsonb,
  ADD COLUMN IF NOT EXISTS target_quarter text,
  ADD COLUMN IF NOT EXISTS target_production_month text,
  ADD COLUMN IF NOT EXISTS quoted_lead_time_weeks integer,
  ADD COLUMN IF NOT EXISTS approvals_complete_date date,
  ADD COLUMN IF NOT EXISTS target_start_date date,
  ADD COLUMN IF NOT EXISTS drive_folder_id text,
  ADD COLUMN IF NOT EXISTS drive_folder_url text,
  -- Client portal columns
  ADD COLUMN IF NOT EXISTS portal_slug text UNIQUE,
  ADD COLUMN IF NOT EXISTS portal_password_hash text,
  ADD COLUMN IF NOT EXISTS portal_step text
    CHECK (portal_step IN ('down_payment', 'approvals', 'scheduling', 'in_production', 'assembly', 'ready_for_install', 'complete'));

-- ---------------------------------------------------------------------------
-- 2. EXTEND subprojects TABLE (Pro tier rich fields, nullable for Starter)
-- ---------------------------------------------------------------------------

ALTER TABLE subprojects
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS estimated_hours numeric,
  ADD COLUMN IF NOT EXISTS estimated_price numeric,
  ADD COLUMN IF NOT EXISTS original_estimated_hours numeric,
  ADD COLUMN IF NOT EXISTS original_estimated_price numeric,
  ADD COLUMN IF NOT EXISTS linear_feet numeric,
  ADD COLUMN IF NOT EXISTS quality_type text,
  ADD COLUMN IF NOT EXISTS rate_per_lf numeric,
  ADD COLUMN IF NOT EXISTS hours_per_lf numeric,
  ADD COLUMN IF NOT EXISTS material_finish text,
  ADD COLUMN IF NOT EXISTS activity_type text,
  ADD COLUMN IF NOT EXISTS dimensions text,
  ADD COLUMN IF NOT EXISTS details_json jsonb,
  ADD COLUMN IF NOT EXISTS exclusions_json jsonb,
  ADD COLUMN IF NOT EXISTS pricing_lines_json jsonb,
  ADD COLUMN IF NOT EXISTS dept_hours jsonb,
  ADD COLUMN IF NOT EXISTS specs_json jsonb,
  ADD COLUMN IF NOT EXISTS spec_lines_json jsonb,
  ADD COLUMN IF NOT EXISTS assembly_lines_json jsonb,
  ADD COLUMN IF NOT EXISTS drive_folder_id text,
  ADD COLUMN IF NOT EXISTS drive_approval_folder_id text,
  ADD COLUMN IF NOT EXISTS selections_confirmed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS selections_confirmed_date timestamptz,
  ADD COLUMN IF NOT EXISTS ready_for_production boolean DEFAULT false;

-- ---------------------------------------------------------------------------
-- 3. CLIENTS + CONTACTS (lightweight, optional — project.client_name remains fallback)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  name text NOT NULL,
  type text CHECK (type IN ('B2B', 'D2C')) DEFAULT 'D2C',
  phone text,
  email text,
  address text,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_clients_org ON clients(org_id);

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  created_at timestamptz DEFAULT now(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  role text,
  phone text,
  email text,
  is_primary boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_contacts_client ON contacts(client_id);

-- ---------------------------------------------------------------------------
-- 4. LEADS + LEAD_SUBPROJECTS (Pro: sales pipeline with copy-on-sell)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  lead_name text NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  client_name text,  -- fallback string if no client_id
  client_email text,
  client_phone text,
  delivery_address text,
  status text NOT NULL DEFAULT 'new_lead'
    CHECK (status IN ('new_lead', 'fifty_fifty', 'ninety_percent', 'sold', 'lost')),
  estimated_price numeric,
  estimated_hours numeric,
  labor_rate numeric,
  scope_description text,
  target_quarter text,
  payment_terms jsonb,
  converted_to_project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  drive_folder_id text,
  drive_folder_url text,
  source_parse_id uuid  -- reference back to parse job
);

CREATE INDEX IF NOT EXISTS idx_leads_org_status ON leads(org_id, status);

CREATE TABLE IF NOT EXISTS lead_subprojects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  name text NOT NULL,
  description text,
  sequence_order integer DEFAULT 0,
  estimated_hours numeric,
  estimated_price numeric,
  quantity numeric,
  linear_feet numeric,
  quality_type text,
  rate_per_lf numeric,
  hours_per_lf numeric,
  material_cost numeric,
  material_finish text,
  activity_type text,
  dimensions text,
  details_json jsonb,
  exclusions_json jsonb,
  pricing_lines_json jsonb,
  dept_hours jsonb,
  specs_json jsonb,
  spec_lines_json jsonb,
  assembly_lines_json jsonb,
  drive_folder_id text,
  drive_approval_folder_id text
);

CREATE INDEX IF NOT EXISTS idx_lead_subprojects_lead ON lead_subprojects(lead_id);

-- Backref from projects to source lead
ALTER TABLE projects
  ADD CONSTRAINT projects_source_lead_fk
  FOREIGN KEY (source_lead_id) REFERENCES leads(id) ON DELETE SET NULL
  NOT VALID;

-- ---------------------------------------------------------------------------
-- 5. RATE BOOK — Categories as first-class + labor/material tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rate_book_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  name text NOT NULL,
  parent_id uuid REFERENCES rate_book_categories(id) ON DELETE CASCADE,
  item_type text NOT NULL DEFAULT 'custom'
    CHECK (item_type IN ('door_style', 'drawer_style', 'cabinet_style', 'install_style', 'hardware', 'finish', 'custom')),
  display_order integer DEFAULT 0,
  notes text,
  -- Confidence metadata (drives the green/yellow/gray/red badges in the mockup)
  confidence_job_count integer DEFAULT 0,
  confidence_last_used_at timestamptz,
  active boolean DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_rate_book_categories_org ON rate_book_categories(org_id);
CREATE INDEX IF NOT EXISTS idx_rate_book_categories_parent ON rate_book_categories(parent_id);

CREATE TABLE IF NOT EXISTS labor_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  category_id uuid REFERENCES rate_book_categories(id) ON DELETE SET NULL,
  category text,  -- freeform fallback
  product_type text,
  finish text,
  unit text DEFAULT 'each',
  engineering_hours numeric DEFAULT 0,
  cnc_hours numeric DEFAULT 0,
  assembly_hours numeric DEFAULT 0,
  finish_hours numeric DEFAULT 0,
  install_hours numeric DEFAULT 0,
  total_hours_per_unit numeric GENERATED ALWAYS AS
    (COALESCE(engineering_hours,0) + COALESCE(cnc_hours,0) + COALESCE(assembly_hours,0) + COALESCE(finish_hours,0) + COALESCE(install_hours,0))
    STORED,
  source text DEFAULT 'manual' CHECK (source IN ('manual', 'formula', 'historical', 'ai')),
  confidence_score numeric,
  confidence_job_count integer DEFAULT 0,
  active boolean DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_labor_rates_org ON labor_rates(org_id);
CREATE INDEX IF NOT EXISTS idx_labor_rates_category ON labor_rates(category_id);

CREATE TABLE IF NOT EXISTS material_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  category_id uuid REFERENCES rate_book_categories(id) ON DELETE SET NULL,
  category text,  -- freeform fallback: sheet_good, lumber, hardware, etc.
  species text,
  product_name text,
  core text,
  finish_type text,
  thickness text,
  size text,
  unit_cost numeric NOT NULL,
  unit text DEFAULT 'sheet',
  lookup_key text,  -- e.g. "walnut_vc_3/4_4x8"
  confidence_job_count integer DEFAULT 0,
  active boolean DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_material_pricing_org ON material_pricing(org_id);
CREATE INDEX IF NOT EXISTS idx_material_pricing_lookup ON material_pricing(lookup_key);

-- ---------------------------------------------------------------------------
-- 6. SELECTIONS (pre-production approvals)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS spec_library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  category text NOT NULL,
  name text NOT NULL,
  description text,
  supplier text,
  default_cost_note text,
  display_order integer DEFAULT 0,
  active boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  subproject_id uuid REFERENCES subprojects(id) ON DELETE CASCADE,
  category text NOT NULL
    CHECK (category IN ('cabinet_exterior', 'cabinet_interior', 'drawer', 'hardware', 'custom')),
  label text NOT NULL,
  spec_value text,
  spec_library_id uuid REFERENCES spec_library_items(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'unconfirmed'
    CHECK (status IN ('unconfirmed', 'pending_review', 'confirmed', 'voided')),
  confirmed_date timestamptz,
  confirmed_by text,
  linked_to_selection_id uuid REFERENCES selections(id) ON DELETE SET NULL,
  display_order integer DEFAULT 0,
  notes text,
  -- Client sign-off (net-new vs. Built OS — portal writes here)
  client_signed_off_at timestamptz,
  client_signed_off_by text
);

CREATE INDEX IF NOT EXISTS idx_selections_project ON selections(project_id);
CREATE INDEX IF NOT EXISTS idx_selections_subproject ON selections(subproject_id);

CREATE TABLE IF NOT EXISTS selection_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  selection_id uuid REFERENCES selections(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created', 'changed', 'confirmed', 'voided', 'linked', 'unlinked')),
  old_value text,
  new_value text,
  old_status text,
  new_status text,
  source text CHECK (source IN ('manual_entry', 'designer_email', 'site_conversation', 'client_drawing', 'change_order', 'client_approval', 'phone_call', 'linked_selection', 'system')),
  source_reference text,
  changed_by text,
  changed_by_name text,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_selection_history_selection ON selection_history(selection_id);

-- ---------------------------------------------------------------------------
-- 7. DRAWING REVISIONS + FINISH SAMPLES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS drawing_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  subproject_id uuid REFERENCES subprojects(id) ON DELETE CASCADE,
  revision_number integer NOT NULL DEFAULT 1,
  submitted_date timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'revision_requested', 'approved')),
  approved_date timestamptz,
  notes text,
  file_url text,
  scope text CHECK (scope IN ('project', 'subproject', 'multi_subproject')) DEFAULT 'subproject',
  covered_subproject_ids uuid[],
  selection_snapshot jsonb,
  is_stale boolean DEFAULT false,
  stale_reason text,
  stale_since timestamptz,
  client_signed_off_at timestamptz,
  client_signed_off_by text
);

CREATE INDEX IF NOT EXISTS idx_drawing_revisions_project ON drawing_revisions(project_id);
CREATE INDEX IF NOT EXISTS idx_drawing_revisions_subproject ON drawing_revisions(subproject_id);

CREATE TABLE IF NOT EXISTS finish_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  subproject_id uuid REFERENCES subprojects(id) ON DELETE CASCADE,
  finish_name text NOT NULL,
  material_spec text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sample_sent', 'revision_requested', 'approved')),
  submitted_date timestamptz,
  approved_date timestamptz,
  revision_count integer DEFAULT 0,
  notes text
);

-- ---------------------------------------------------------------------------
-- 8. CHANGE ORDERS (foundation only — no UI this week)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS change_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  subproject_id uuid REFERENCES subprojects(id) ON DELETE SET NULL,
  change_order_number integer NOT NULL,
  description text NOT NULL,
  impact_type text NOT NULL DEFAULT 'modify_existing'
    CHECK (impact_type IN ('new_subproject', 'modify_existing', 'project_level')),
  price_impact numeric DEFAULT 0,
  hours_impact numeric DEFAULT 0,
  resulting_subproject_id uuid REFERENCES subprojects(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent_to_client', 'approved', 'rejected')),
  submitted_date timestamptz,
  approved_date timestamptz,
  notes text,
  qb_invoice_id text,
  qb_synced_at timestamptz,
  client_signed_off_at timestamptz,
  client_signed_off_by text
);

CREATE INDEX IF NOT EXISTS idx_change_orders_project ON change_orders(project_id);

-- ---------------------------------------------------------------------------
-- 9. CASH FLOW + PORTAL TIMELINE
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cash_flow_receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  created_at timestamptz DEFAULT now(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'receivable' CHECK (type IN ('receivable', 'payable')),
  description text,
  milestone_label text,
  milestone_pct numeric,
  milestone_trigger text,  -- e.g. 'sold', 'scheduled', 'in_production', 'delivered'
  amount numeric NOT NULL,
  expected_date date,
  status text NOT NULL DEFAULT 'projected'
    CHECK (status IN ('projected', 'invoiced', 'received', 'cancelled')),
  invoiced_date date,
  received_date date,
  received_amount numeric,
  qbo_invoice_id text,
  qbo_synced_at timestamptz,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_cash_flow_project ON cash_flow_receivables(project_id);

CREATE TABLE IF NOT EXISTS portal_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  event_type text NOT NULL,  -- e.g. 'status_changed', 'selection_confirmed', 'drawing_approved', 'payment_received'
  event_label text NOT NULL,
  from_value text,
  to_value text,
  actor_type text CHECK (actor_type IN ('shop', 'client', 'system')),
  actor_name text,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_portal_timeline_project ON portal_timeline(project_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 10. LEARNING LOOP + SHOP RATE SNAPSHOTS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shop_rate_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  created_at timestamptz DEFAULT now(),
  effective_rate numeric NOT NULL,
  computed_at timestamptz DEFAULT now(),
  overhead_monthly numeric,
  labor_cost_monthly numeric,
  billable_hours_monthly numeric,
  utilization_pct numeric,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_shop_rate_snapshots_org ON shop_rate_snapshots(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS project_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  created_at timestamptz DEFAULT now(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  subproject_id uuid REFERENCES subprojects(id) ON DELETE CASCADE,
  category_id uuid REFERENCES rate_book_categories(id) ON DELETE SET NULL,
  category_name text,
  quality_type text,
  linear_feet numeric,
  estimated_hours numeric,
  actual_hours numeric,
  hours_variance numeric,
  hours_variance_pct numeric,
  estimated_price numeric,
  actual_revenue numeric,
  estimated_material_cost numeric,
  actual_material_cost numeric,
  material_variance numeric,
  material_variance_pct numeric,
  shop_rate_used numeric,
  dept_hours_estimated jsonb,
  dept_hours_actual jsonb,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_project_learnings_org ON project_learnings(org_id);
CREATE INDEX IF NOT EXISTS idx_project_learnings_category ON project_learnings(category_id);

-- Rate adjustment proposals (bidirectional — can suggest raise OR lower)
CREATE TABLE IF NOT EXISTS rate_adjustment_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  created_at timestamptz DEFAULT now(),
  labor_rate_id uuid REFERENCES labor_rates(id) ON DELETE CASCADE,
  category_id uuid REFERENCES rate_book_categories(id) ON DELETE SET NULL,
  direction text CHECK (direction IN ('up', 'down', 'split', 'quiet')),
  field text,  -- which field of labor_rates: engineering_hours, cnc_hours, etc.
  current_value numeric,
  proposed_value numeric,
  confidence text CHECK (confidence IN ('high', 'medium', 'low')),
  source_job_count integer,
  impact_hours numeric,
  impact_dollars numeric,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'rejected', 'deferred', 'superseded')),
  reviewed_at timestamptz,
  reviewed_by text,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_rate_adjustment_proposals_org ON rate_adjustment_proposals(org_id, status);

-- ---------------------------------------------------------------------------
-- 11. VENDORS + POs (foundation only — no UI this week)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  name text NOT NULL,
  contact_name text,
  email text,
  phone text,
  address text,
  website text,
  payment_terms text,
  account_number text,
  notes text,
  active boolean DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_vendors_org ON vendors(org_id);

CREATE TABLE IF NOT EXISTS vendor_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  vendor_id uuid REFERENCES vendors(id) ON DELETE CASCADE,
  material_pricing_id uuid REFERENCES material_pricing(id) ON DELETE CASCADE,
  vendor_sku text,
  vendor_price numeric,
  last_quoted_date date,
  is_preferred boolean DEFAULT false,
  notes text
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  po_number text,
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'acknowledged', 'received', 'partial', 'cancelled')),
  order_date date,
  expected_delivery_date date,
  actual_delivery_date date,
  subtotal numeric DEFAULT 0,
  tax numeric DEFAULT 0,
  shipping numeric DEFAULT 0,
  total numeric DEFAULT 0,
  notes text,
  source_document_url text,
  parsed_by_ai boolean DEFAULT false,
  assigned_to text
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_project ON purchase_orders(project_id);

CREATE TABLE IF NOT EXISTS po_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE CASCADE,
  material_pricing_id uuid REFERENCES material_pricing(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric NOT NULL,
  unit text DEFAULT 'each',
  unit_price numeric NOT NULL,
  total_price numeric NOT NULL,
  received_quantity numeric DEFAULT 0,
  notes text
);

-- ---------------------------------------------------------------------------
-- 12. DEPARTMENT ALLOCATIONS (if not already present)
--     Built OS uses this to explode dept_hours → rows for scheduling
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS department_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  subproject_id uuid REFERENCES subprojects(id) ON DELETE CASCADE,
  lead_subproject_id uuid REFERENCES lead_subprojects(id) ON DELETE CASCADE,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  name text NOT NULL,
  notes text,
  scheduled_date date,
  sequence_order integer DEFAULT 0,
  depends_on_allocation_id uuid REFERENCES department_allocations(id) ON DELETE SET NULL,
  estimated_hours numeric NOT NULL DEFAULT 0,
  actual_hours numeric DEFAULT 0,
  completed boolean DEFAULT false,
  completed_at timestamptz,
  scheduled_days numeric,
  crew_size integer
);

CREATE INDEX IF NOT EXISTS idx_department_allocations_subproject ON department_allocations(subproject_id);
CREATE INDEX IF NOT EXISTS idx_department_allocations_scheduled_date ON department_allocations(scheduled_date);

-- ---------------------------------------------------------------------------
-- 13. COMMENTS (Built OS has this on leads + projects)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  entity_type text NOT NULL CHECK (entity_type IN ('lead', 'project')),
  entity_id uuid NOT NULL,
  author text,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  content text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(entity_type, entity_id);

-- ============================================================================
-- DONE. Summary of what was added:
--   - projects extended (production_phase, lead source, portal, client ref)
--   - subprojects extended (JSONB spec payloads, LF, quality, originals)
--   - clients + contacts (lightweight)
--   - leads + lead_subprojects (with copy-on-sell foundation)
--   - rate_book_categories + labor_rates + material_pricing (with category FKs)
--   - selections + selection_history + spec_library_items
--   - drawing_revisions + finish_samples
--   - change_orders (foundation, no UI this week)
--   - cash_flow_receivables + portal_timeline
--   - project_learnings + rate_adjustment_proposals + shop_rate_snapshots
--   - vendors + vendor_materials + purchase_orders + po_line_items (foundation)
--   - department_allocations (if missing)
--   - comments
-- ============================================================================
