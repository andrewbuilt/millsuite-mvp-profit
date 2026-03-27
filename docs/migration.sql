-- MillSuite MVP — Database Schema
-- Run in Supabase SQL editor

-- ============================================================================
-- ORGS
-- ============================================================================
CREATE TABLE orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  owner_id UUID,
  shop_rate DECIMAL DEFAULT 75,
  consumable_markup_pct DECIMAL DEFAULT 15,
  profit_margin_pct DECIMAL DEFAULT 35,
  employee_types_enabled BOOLEAN DEFAULT false,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan TEXT DEFAULT 'trial',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- USERS
-- ============================================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  auth_user_id UUID UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  employee_type TEXT CHECK (employee_type IN ('builder', 'finisher', 'installer', 'drafter')),
  hourly_cost DECIMAL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_users_org ON users(org_id);
CREATE INDEX idx_users_auth ON users(auth_user_id);

-- ============================================================================
-- PROJECTS
-- ============================================================================
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  client_name TEXT,
  client_email TEXT,
  client_phone TEXT,
  status TEXT NOT NULL DEFAULT 'bidding' CHECK (status IN ('bidding', 'active', 'complete')),
  bid_total DECIMAL DEFAULT 0,
  actual_total DECIMAL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  sold_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_projects_org ON projects(org_id);
CREATE INDEX idx_projects_status ON projects(org_id, status);

-- ============================================================================
-- SUBPROJECTS
-- ============================================================================
CREATE TABLE subprojects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  material_cost DECIMAL DEFAULT 0,
  labor_hours DECIMAL DEFAULT 0,
  labor_cost DECIMAL DEFAULT 0,
  consumable_markup_pct DECIMAL,
  profit_margin_pct DECIMAL,
  price DECIMAL DEFAULT 0,
  manual_price DECIMAL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_subprojects_project ON subprojects(project_id);

-- ============================================================================
-- SUBPROJECT LABOR (detailed mode — per employee type)
-- ============================================================================
CREATE TABLE subproject_labor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subproject_id UUID NOT NULL REFERENCES subprojects(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  employee_type TEXT NOT NULL CHECK (employee_type IN ('builder', 'finisher', 'installer', 'drafter')),
  estimated_hours DECIMAL DEFAULT 0,
  rate DECIMAL DEFAULT 0
);

CREATE INDEX idx_subproject_labor_sub ON subproject_labor(subproject_id);

-- ============================================================================
-- TIME ENTRIES
-- ============================================================================
CREATE TABLE time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subproject_id UUID REFERENCES subprojects(id) ON DELETE SET NULL,
  employee_type TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_minutes INT NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_time_entries_project ON time_entries(project_id);
CREATE INDEX idx_time_entries_user ON time_entries(user_id);
CREATE INDEX idx_time_entries_org ON time_entries(org_id);

-- ============================================================================
-- INVOICES (parsed vendor invoices)
-- ============================================================================
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subproject_id UUID REFERENCES subprojects(id) ON DELETE SET NULL,
  vendor_name TEXT,
  invoice_number TEXT,
  invoice_date DATE,
  total_amount DECIMAL DEFAULT 0,
  file_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_invoices_project ON invoices(project_id);

-- ============================================================================
-- INVOICE LINE ITEMS
-- ============================================================================
CREATE TABLE invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subproject_id UUID REFERENCES subprojects(id) ON DELETE SET NULL,
  description TEXT,
  quantity DECIMAL DEFAULT 1,
  unit_price DECIMAL DEFAULT 0,
  total DECIMAL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_invoice_items_invoice ON invoice_line_items(invoice_id);

-- ============================================================================
-- SHOP RATE SETTINGS
-- ============================================================================
CREATE TABLE shop_rate_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  monthly_rent DECIMAL DEFAULT 0,
  monthly_utilities DECIMAL DEFAULT 0,
  monthly_insurance DECIMAL DEFAULT 0,
  monthly_equipment DECIMAL DEFAULT 0,
  monthly_misc_overhead DECIMAL DEFAULT 0,
  owner_salary DECIMAL DEFAULT 0,
  total_payroll DECIMAL DEFAULT 0,
  target_profit_pct DECIMAL DEFAULT 20,
  working_days_per_month DECIMAL DEFAULT 21,
  hours_per_day DECIMAL DEFAULT 8,
  computed_shop_rate DECIMAL DEFAULT 75,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_shop_rate_org ON shop_rate_settings(org_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE subprojects ENABLE ROW LEVEL SECURITY;
ALTER TABLE subproject_labor ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_rate_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies: users can only see data from their org
-- (Using service role key for API routes bypasses RLS)

CREATE POLICY "Users see own org" ON orgs
  FOR ALL USING (id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users see own org data" ON users
  FOR ALL USING (org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users see own org projects" ON projects
  FOR ALL USING (org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users see own org subprojects" ON subprojects
  FOR ALL USING (org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users see own org subproject labor" ON subproject_labor
  FOR ALL USING (org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users see own org time entries" ON time_entries
  FOR ALL USING (org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users see own org invoices" ON invoices
  FOR ALL USING (org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users see own org invoice items" ON invoice_line_items
  FOR ALL USING (org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid()));

CREATE POLICY "Users see own org shop rate" ON shop_rate_settings
  FOR ALL USING (org_id IN (SELECT org_id FROM users WHERE auth_user_id = auth.uid()));

-- ============================================================================
-- GRANTS
-- ============================================================================
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
