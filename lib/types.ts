// lib/types.ts
// MillSuite OS type definitions.
// Phase 0 cleanup: removed Lead/LeadSubproject (projects.stage is the pipeline),
// Selection (BUILT OS clone — rebuilt as finish specs in Phase 2/6), and client
// portal types (out of scope).

// ── Core ──

export type ProjectStatus = 'bidding' | 'active' | 'complete' | 'archived'
export type ProductionPhase = 'pre_production' | 'scheduling' | 'in_production' | null
export type ProjectStage = 'new_lead' | 'fifty_fifty' | 'ninety_percent' | 'sold' | 'lost'

export interface Client {
  id: string
  org_id: string | null
  name: string
  email: string | null
  phone: string | null
  billing_address: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  client_id: string | null
  org_id: string | null
  name: string
  email: string | null
  phone: string | null
  role: string | null
  is_primary: boolean
  created_at: string
}

// ── Payment milestones (now per-project; Phase 4 wires the builder) ──

export interface PaymentMilestone {
  label: string
  pct: number
  trigger?: string // 'on_sold' | 'on_approvals' | 'on_delivery' | custom
}

export interface PaymentTerms {
  milestones?: PaymentMilestone[]
  net_days?: number
}

// ── Projects ──

export interface Project {
  id: string
  org_id: string | null
  name: string
  client_name: string | null // fallback string
  client_id: string | null
  contact_id: string | null
  stage: ProjectStage
  status: ProjectStatus
  production_phase: ProductionPhase
  bid_total: number
  actual_total: number
  sold_at: string | null
  completed_at: string | null
  due_date: string | null

  // Pro-tier fields (nullable for Starter)
  delivery_address: string | null
  estimated_price: number | null
  estimated_hours: number | null
  locked_shop_rate: number | null
  payment_terms: PaymentTerms | null
  target_quarter: string | null
  target_production_month: string | null
  quoted_lead_time_weeks: number | null
  approvals_complete_date: string | null
  target_start_date: string | null
  drive_folder_id: string | null
  drive_folder_url: string | null

  // Joined
  client?: Client | null
  contact?: Contact | null
  updated_at?: string
  created_at?: string
}

// ── Subprojects ──

export interface Subproject {
  id: string
  project_id: string
  org_id: string | null
  name: string
  sort_order: number

  // Starter / v1
  material_cost: number | null
  labor_hours: number | null
  labor_cost: number | null
  price: number | null
  manual_price: number | null

  // Pro / v2+v3 (nullable for Starter).
  // NOTE: some of these jsonb columns (spec_lines_json, specs_json,
  // assembly_lines_json, selections_confirmed*) are legacy BUILT OS shapes.
  // Phase 2 replaces the subproject editor; this struct will be trimmed then.
  description: string | null
  estimated_hours: number | null
  estimated_price: number | null
  original_estimated_hours: number | null
  original_estimated_price: number | null
  linear_feet: number | null
  quality_type: string | null
  rate_per_lf: number | null
  hours_per_lf: number | null
  material_finish: string | null
  activity_type: string | null
  dimensions: string | null
  details_json: any | null
  exclusions_json: any | null
  pricing_lines_json: any | null
  dept_hours: Record<string, number> | null
  specs_json: any[] | null
  spec_lines_json: any | null
  assembly_lines_json: any | null
  drive_folder_id: string | null
  drive_approval_folder_id: string | null
  ready_for_production: boolean | null
}

// ── Parsed scope items (project_scope_items table) ──
// These shapes are written by /api/parse-drawings and read by lib/bom/* to
// produce the sheet-goods / hardware / finish takeoff. Mirrored in takeoff's
// TakeoffItem — keep the two in sync.

export type ScopeItemCategory =
  | 'base_cabinet'
  | 'upper_cabinet'
  | 'full_height'
  | 'vanity'
  | 'drawer_box'
  | 'countertop'
  | 'panel'
  | 'scribe'
  | 'led'
  | 'hardware'
  | 'custom'
  | 'other'

export type ScopeItemQuality = 'standard' | 'premium' | 'custom' | 'unspecified'

export interface ScopeItemFeatures {
  drawer_count?: number
  door_style?: string | null
  soft_close?: boolean | null
  hinge_type?: string | null
  slide_type?: string | null
  adjustable_shelves?: number | null
  rollout_trays?: number | null
  lazy_susan?: boolean
  trash_pullout?: boolean
  has_led?: boolean
  notes?: string
}

export interface ScopeItemMaterialSpecs {
  exterior_species?: string | null
  exterior_thickness?: string | null
  interior_material?: string | null
  interior_thickness?: string | null
  back_material?: string | null
  back_thickness?: string | null
  edgeband?: string | null
}

export interface ScopeItemHardwareSpec {
  type?: string | null
  count?: number | null
  length?: string | null
  size?: string | null
}

export interface ScopeItemHardwareSpecs {
  hinges?: ScopeItemHardwareSpec
  slides?: ScopeItemHardwareSpec
  pulls?: ScopeItemHardwareSpec
  specialty?: ScopeItemHardwareSpec[]
}

export interface ScopeItemFinishSpecs {
  finish_type?: string | null
  stain_color?: string | null
  sheen?: string | null
  sides_to_finish?: 'exterior_only' | 'all_sides'
  notes?: string
}

/**
 * A scope item as persisted in project_scope_items. Created from the parser
 * output or by manual entry in the takeoff page. Read by lib/bom/* to produce
 * the sheet-goods / hardware / finish rollup.
 */
export interface ProjectScopeItem {
  id: string
  org_id: string | null
  project_id: string
  subproject_id: string | null
  sort_order: number
  name: string
  room: string | null
  category: ScopeItemCategory | null
  item_type: string | null
  quality: ScopeItemQuality | null
  linear_feet: number | null
  quantity: number
  features: ScopeItemFeatures
  material_specs: ScopeItemMaterialSpecs
  hardware_specs: ScopeItemHardwareSpecs
  finish_specs: ScopeItemFinishSpecs
  parser_confidence: number | null
  needs_review: boolean
  source_sheet: string | null
  created_at: string
  updated_at: string
}

// ── Drawings (kept; Phase 6 will revisit) ──

export interface DrawingRevision {
  id: string
  project_id: string
  subproject_id: string | null
  revision_number: number
  status: 'draft' | 'client_review' | 'approved' | 'rejected' | 'superseded'
  drive_file_id: string | null
  drive_file_url: string | null
  is_stale: boolean
  notes: string | null
  submitted_at: string | null
  client_signed_off_at: string | null
  client_signed_off_by: string | null
  created_at: string
  created_by: string | null
}

// ── Rate book (Phase 1 will rebuild on top of this; kept for now) ──

export type RateBookItemType =
  | 'door_style'
  | 'drawer_style'
  | 'cabinet_style'
  | 'install_style'
  | 'hardware'
  | 'finish'
  | 'custom'

export interface RateBookCategory {
  id: string
  org_id: string | null
  parent_id: string | null
  name: string
  item_type: RateBookItemType
  display_order: number
  notes: string | null
  confidence_job_count: number
  confidence_last_used_at: string | null
  active: boolean
  created_at: string
}

export interface LaborRate {
  id: string
  org_id: string | null
  category_id: string | null
  name: string
  unit: string // 'lf' | 'each' | 'hr' | etc.
  hours_per_unit: number | null
  install_hours_per_unit: number | null
  total_hours_per_unit: number | null // generated column
  notes: string | null
  active: boolean
  confidence_job_count: number
  confidence_last_used_at: string | null
  created_at: string
  updated_at: string
}

export interface MaterialPricing {
  id: string
  org_id: string | null
  category_id: string | null
  lookup_key: string | null
  name: string
  unit: string
  cost_per_unit: number
  notes: string | null
  active: boolean
  created_at: string
  updated_at: string
}

// ── Change orders, cash flow (foundation) ──

export interface ChangeOrder {
  id: string
  project_id: string
  created_at: string
  number: number
  description: string
  amount: number
  status: 'draft' | 'sent' | 'approved' | 'rejected' | 'voided'
  qb_invoice_id: string | null
  client_signed_off_at: string | null
  client_signed_off_by: string | null
}

export interface CashFlowReceivable {
  id: string
  project_id: string
  created_at: string
  type: 'receivable' | 'payable'
  description: string
  amount: number
  expected_date: string | null
  received_date: string | null
  status: 'projected' | 'invoiced' | 'received' | 'overdue'
  source: 'system' | 'manual'
  milestone_trigger: string | null
  qbo_invoice_id: string | null
  display_order: number
}

// ── Comments ──

export interface Comment {
  id: string
  entity_type: 'project'
  entity_id: string
  content: string
  author: string
  author_id: string | null
  mentions: string[] | null
  created_at: string
  updated_at: string
}
