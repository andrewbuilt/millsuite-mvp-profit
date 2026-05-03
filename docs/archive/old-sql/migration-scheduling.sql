-- MillSuite Scheduling Tables
-- Run AFTER the base migration (migration.sql)

CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6B7280',
  display_order INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  hours_per_day DECIMAL DEFAULT 8,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_departments_org ON departments(org_id);

CREATE TABLE department_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_dept_members_dept ON department_members(department_id);
CREATE INDEX idx_dept_members_user ON department_members(user_id);

CREATE TABLE department_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  subproject_id UUID NOT NULL REFERENCES subprojects(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  estimated_hours DECIMAL DEFAULT 0,
  actual_hours DECIMAL DEFAULT 0,
  scheduled_date TEXT,
  scheduled_days INT,
  crew_size INT,
  completed BOOLEAN DEFAULT false,
  sequence_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_dept_allocs_sub ON department_allocations(subproject_id);
CREATE INDEX idx_dept_allocs_dept ON department_allocations(department_id);

CREATE TABLE project_month_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  month_date TEXT NOT NULL,
  hours_allocated DECIMAL DEFAULT 0,
  department_hours JSONB,
  display_order INT DEFAULT 0,
  split_index INT DEFAULT 1,
  split_total INT DEFAULT 1,
  split_group_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_month_allocs_project ON project_month_allocations(project_id);
CREATE INDEX idx_month_allocs_month ON project_month_allocations(month_date);

CREATE TABLE capacity_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  override_date TEXT NOT NULL,
  team_member_id UUID REFERENCES users(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  hours_reduction DECIMAL DEFAULT 0,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_capacity_overrides_date ON capacity_overrides(override_date);

ALTER TABLE departments DISABLE ROW LEVEL SECURITY;
ALTER TABLE department_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE department_allocations DISABLE ROW LEVEL SECURITY;
ALTER TABLE project_month_allocations DISABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_overrides DISABLE ROW LEVEL SECURITY;
