// lib/types.ts
// MillSuite OS type definitions — adapted from Built OS for MVP's simpler schema.
// Projects use `name` (not project_name). Status enum is 4-state with a separate
// nullable `production_phase` column for Pro tier.

// ── Core ──

export type ProjectStatus = 'bidding' | 'active' | 'complete' | 'archived'
export type ProductionPhase = 'pre_production' | 'scheduling' | 'in_production' | null
export type LeadStatus = 'new_lead' | 'fifty_fifty' | 'ninety_percent' | 'sold' | 'lost'

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

// ── Leads ──

export interface PaymentMilestone {
  label: string
  pct: number
  trigger?: string // e.g. 'on_sold', 'on_approvals', 'on_delivery'
}

export interface PaymentTerms {
  milestones?: PaymentMilestone[]
  net_days?: number
}

export interface Lead {
  id: string
  org_id: string | null
  created_at: string
  updated_at: string
  lead_name: string
  client_id: string | null
  contact_id: string | null
  client_name: string | null
  client_email: string | null
  client_phone: string | null
  delivery_address: string | null
  status: LeadStatus
  estimated_price: number | null
  estimated_hours: number | null
  labor_rate: number | null
  scope_description: string | null
  target_quarter: string | null
  payment_terms: PaymentTerms | null
  converted_to_project_id: string | null
  drive_folder_id: string | null
  drive_folder_url: string | null
  source_parse_id: string | null

  // Joined relations
  client?: Client | null
  contact?: Contact | null
  lead_subprojects?: LeadSubproject[]
}

export interface LeadSubproject {
  id: string
  lead_id: string
  created_at: string
  name: string
  description: string | null
  sequence_order: number
  estimated_hours: number | null
  estimated_price: number | null
  quantity: number | null
  linear_feet: number | null
  quality_type: string | null
  rate_per_lf: number | null
  hours_per_lf: number | null
  material_cost: number | null
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
}

// ── Projects (extends MVP's existing Project interface) ──

export interface Project {
  id: string
  org_id: string | null
  name: string
  client_name: string | null // fallback string
  client_id: string | null
  contact_id: string | null
  status: ProjectStatus
  production_phase: ProductionPhase
  bid_total: number
  actual_total: number
  sold_at: string | null
  completed_at: string | null
  due_date: string | null

  // Pro-tier fields (nullable for Starter)
  source_lead_id: string | null
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

  // Portal
  portal_slug: string | null
  portal_password_hash: string | null
  portal_step: PortalStep | null

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

  // Pro / v2+v3 (nullable for Starter)
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
  selections_confirmed: boolean | null
  selections_confirmed_date: string | null
  ready_for_production: boolean | null
}

// ── Portal ──

export const PORTAL_STEPS = [
  'down_payment',
  'approvals',
  'scheduling',
  'in_production',
  'assembly',
  'ready_for_install',
  'complete',
] as const

export type PortalStep = typeof PORTAL_STEPS[number]

export interface PortalTimelineEntry {
  id: string
  project_id: string
  created_at: string
  event_type: string
  event_label: string
  event_detail: string | null
  portal_step: PortalStep | null
  actor_type: 'shop' | 'client' | 'system' | null
  triggered_by: string | null
}

// ── Selections + Drawings ──

export type SelectionStatus = 'unconfirmed' | 'pending_review' | 'confirmed' | 'voided'

export interface Selection {
  id: string
  project_id: string
  subproject_id: string | null
  category: string
  label: string
  spec_value: string | null
  status: SelectionStatus
  display_order: number
  confirmed_date: string | null
  confirmed_by: string | null
  client_signed_off_at: string | null
  client_signed_off_by: string | null
  spec_library_item_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface DrawingRevision {
  id: string
  project_id: string
  subproject_id: string | null
  revision_number: number
  status: 'draft' | 'client_review' | 'approved' | 'rejected' | 'superseded'
  drive_file_id: string | null
  drive_file_url: string | null
  is_stale: boolean
  selection_snapshot: any | null
  notes: string | null
  submitted_at: string | null
  client_signed_off_at: string | null
  client_signed_off_by: string | null
  created_at: string
  created_by: string | null
}

// ── Rate book ──

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

// ── Change orders, cash flow, vendors (foundation only, no UI this week) ──

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
  entity_type: 'lead' | 'project'
  entity_id: string
  content: string
  author: string
  author_id: string | null
  mentions: string[] | null
  source_lead_id: string | null
  created_at: string
  updated_at: string
}
