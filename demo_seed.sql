-- ============================================================================
-- MillSuite DEMO SEED  —  org "Built"  (andrew@builtthings.com)
-- org_id: 85b67e22-ebf4-4d78-94e8-3b1c73ca702f
--
-- Run each numbered PIECE one at a time (Supabase SQL editor / service role).
-- Every row uses a fixed UUID + ON CONFLICT DO NOTHING, so pieces are safe to
-- re-run. All demo rows share recognizable UUID prefixes for easy cleanup
-- (see PIECE 99 at the bottom). Dates are anchored around 2026-06-24.
--
-- Departments (Built): Engineering 4c86012d / CNC 1e80fa88 / Assembly 274cf46e
--                      Finish aa1c65e2 / Install 045d9ee2 / MGMT 39063db3
-- ============================================================================


-- ============================================================================
-- PIECE 0 — sanity check: confirm you're pointing at the right org
-- ============================================================================
SELECT id, name, slug FROM orgs WHERE id = '85b67e22-ebf4-4d78-94e8-3b1c73ca702f';
-- Expect: Built | built


-- ============================================================================
-- PIECE 1 — Clients (3 jobs get real client records)
-- ============================================================================
INSERT INTO clients (id, org_id, name, type, phone, email, address, notes) VALUES
  ('c1000000-0000-0000-0000-000000000001','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','Karen Westfield','D2C','415-555-0182','karen.westfield@example.com','118 Crestline Dr, Mill Valley, CA','Repeat residential client.'),
  ('c1000000-0000-0000-0000-000000000002','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','Birch & Co Retail','B2B','510-555-0144','procurement@birchandco.com','2200 Telegraph Ave, Oakland, CA','Retail rollout — multiple store fixtures.'),
  ('c1000000-0000-0000-0000-000000000003','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','City of Maple Falls','B2B','209-555-0111','facilities@maplefalls.gov','1 Civic Center Plaza, Maple Falls, CA','Municipal — library renovation.')
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- PIECE 2 — Pipeline LEADS (projects with stage new_lead / fifty_fifty / ninety_percent)
-- ============================================================================
INSERT INTO projects (id, org_id, name, stage, client_name, client_email, client_phone, estimated_price, estimated_hours, due_date, notes) VALUES
  ('9b000000-0000-0000-0000-000000000011','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','Harborview Penthouse Kitchen','new_lead','Marina Voss','marina.voss@example.com','415-555-0307',75000,360,'2026-10-15','Inbound from referral. High-end walnut kitchen.'),
  ('9b000000-0000-0000-0000-000000000012','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','Oakland Craftsman Built-Ins','fifty_fifty','Dev Patel','dev.patel@example.com','510-555-0288',38000,210,'2026-09-01','Estimate sent, awaiting feedback on door style.'),
  ('9b000000-0000-0000-0000-000000000013','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','Sterling Dental Office Casework','ninety_percent','Sterling Dental Group','office@sterlingdental.example','209-555-0199',61500,330,'2026-08-20','Verbal yes — contract out for signature.'),
  ('9b000000-0000-0000-0000-000000000014','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','Lakeshore Vanity Package','new_lead','Tom & Rita Hill','hill.family@example.com','916-555-0163',14200,90,'2026-09-30','Small job — two bathroom vanities.')
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- PIECE 3 — Sold / in-production JOBS (3 projects, linked to clients)
-- ============================================================================
INSERT INTO projects (id, org_id, name, stage, client_id, client_name, client_email, client_phone, bid_total, estimated_price, estimated_hours, sold_at, due_date, notes) VALUES
  ('9b000000-0000-0000-0000-000000000001','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','Westfield Residence Kitchen & Pantry','sold','c1000000-0000-0000-0000-000000000001','Karen Westfield','karen.westfield@example.com','415-555-0182',84500,84500,420,'2026-06-02 16:30:00-07','2026-08-15','Deposit paid. Engineering starts early July.'),
  ('9b000000-0000-0000-0000-000000000002','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','Birch & Co Retail Fixtures','production','c1000000-0000-0000-0000-000000000002','Birch & Co Retail','procurement@birchandco.com','510-555-0144',132000,132000,610,'2026-05-18 11:00:00-07','2026-07-31','In production — CNC underway.'),
  ('9b000000-0000-0000-0000-000000000003','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','Maple Falls Library Built-Ins','production','c1000000-0000-0000-0000-000000000003','City of Maple Falls','facilities@maplefalls.gov','209-555-0111',96750,96750,510,'2026-05-26 09:00:00-07','2026-09-01','In production — reading room first.')
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- PIECE 4 — Subprojects (2 per job)
-- ============================================================================
INSERT INTO subprojects (id, org_id, project_id, name, sort_order, estimated_hours, estimated_price, price) VALUES
  ('5b000000-0000-0000-0000-000000000001','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000001','Kitchen Cabinets',1,260,52000,52000),
  ('5b000000-0000-0000-0000-000000000002','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000001','Walk-in Pantry',2,160,32500,32500),
  ('5b000000-0000-0000-0000-000000000003','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000002','Display Fixtures',1,380,86000,86000),
  ('5b000000-0000-0000-0000-000000000004','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000002','Checkout Counters',2,230,46000,46000),
  ('5b000000-0000-0000-0000-000000000005','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000003','Reading Room Built-Ins',1,320,61000,61000),
  ('5b000000-0000-0000-0000-000000000006','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000003','Circulation Desk',2,190,35750,35750)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- PIECE 5 — SCHEDULE: department_allocations (sequenced across departments)
--   Birch (in production) is partly complete; Library + Westfield upcoming.
-- ============================================================================
INSERT INTO department_allocations
  (id, org_id, subproject_id, department_id, estimated_hours, actual_hours, scheduled_date, scheduled_days, crew_size, completed, sequence_order) VALUES
  -- Birch & Co — Display Fixtures (sp 003)
  ('a110c000-0000-0000-0000-000000000001','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','5b000000-0000-0000-0000-000000000003','4c86012d-8a93-41a9-885c-840f6bcfad6b',32,30,'2026-06-22',2,2,true,1),
  ('a110c000-0000-0000-0000-000000000002','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','5b000000-0000-0000-0000-000000000003','1e80fa88-57ab-4324-bd8b-3a23604eb626',48,18,'2026-06-25',3,2,false,2),
  ('a110c000-0000-0000-0000-000000000003','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','5b000000-0000-0000-0000-000000000003','274cf46e-6506-4809-9666-4ad4e9640659',64,0,'2026-06-30',4,2,false,3),
  ('a110c000-0000-0000-0000-000000000004','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','5b000000-0000-0000-0000-000000000003','aa1c65e2-ee5c-4d32-97a1-09ea6d5112e5',48,0,'2026-07-07',3,2,false,4),
  -- Birch & Co — Checkout Counters (sp 004)
  ('a110c000-0000-0000-0000-000000000005','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','5b000000-0000-0000-0000-000000000004','045d9ee2-a8f6-4dbc-af57-2e948b9637ee',32,0,'2026-07-14',2,2,false,5),
  -- Maple Falls Library — Reading Room Built-Ins (sp 005)
  ('a110c000-0000-0000-0000-000000000006','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','5b000000-0000-0000-0000-000000000005','4c86012d-8a93-41a9-885c-840f6bcfad6b',28,12,'2026-06-29',2,2,false,1),
  ('a110c000-0000-0000-0000-000000000007','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','5b000000-0000-0000-0000-000000000005','1e80fa88-57ab-4324-bd8b-3a23604eb626',44,0,'2026-07-02',3,2,false,2),
  ('a110c000-0000-0000-0000-000000000008','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','5b000000-0000-0000-0000-000000000005','274cf46e-6506-4809-9666-4ad4e9640659',60,0,'2026-07-08',4,2,false,3),
  -- Maple Falls Library — Circulation Desk (sp 006)
  ('a110c000-0000-0000-0000-000000000009','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','5b000000-0000-0000-0000-000000000006','aa1c65e2-ee5c-4d32-97a1-09ea6d5112e5',40,0,'2026-07-15',3,2,false,4),
  -- Westfield Residence — Kitchen Cabinets (sp 001)
  ('a110c000-0000-0000-0000-000000000010','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','5b000000-0000-0000-0000-000000000001','4c86012d-8a93-41a9-885c-840f6bcfad6b',30,0,'2026-07-06',2,2,false,1),
  ('a110c000-0000-0000-0000-000000000011','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','5b000000-0000-0000-0000-000000000001','1e80fa88-57ab-4324-bd8b-3a23604eb626',46,0,'2026-07-09',3,2,false,2)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- PIECE 6 — CAPACITY overrides (holiday, individual PTO, half-day)
--   team_member_id has an FK to users(id). Built's only user row is Andrew,
--   so the individual-PTO row points at his user id. Holiday + dept rows
--   leave team_member_id NULL.
-- ============================================================================
INSERT INTO capacity_overrides
  (id, org_id, override_date, team_member_id, department_id, hours_reduction, reason, is_full_day) VALUES
  ('caca0000-0000-0000-0000-000000000001','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','2026-07-03',NULL,NULL,0,'Independence Day (observed) — shop closed',true),
  ('caca0000-0000-0000-0000-000000000002','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','2026-07-10','2fff60f1-d914-42a7-bb57-668312d097a4',NULL,0,'Andrew — PTO',true),
  ('caca0000-0000-0000-0000-000000000003','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','2026-07-17',NULL,'aa1c65e2-ee5c-4d32-97a1-09ea6d5112e5',4,'Finish dept — spray booth maintenance (half day)',false)
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- PIECE 7 — TIME tracked (actuals on the two in-production jobs)
--   user_id has an FK to users(id); Built's only user is Andrew, so all
--   entries use his id. department_id still varies (Engineering / CNC), so
--   per-department actuals-vs-estimated still demo correctly.
-- ============================================================================
INSERT INTO time_entries
  (id, org_id, user_id, project_id, subproject_id, employee_type, started_at, ended_at, duration_minutes, notes, department_id) VALUES
  ('7e000000-0000-0000-0000-000000000001','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','2fff60f1-d914-42a7-bb57-668312d097a4','9b000000-0000-0000-0000-000000000002','5b000000-0000-0000-0000-000000000003','builder','2026-06-22 08:00:00-07','2026-06-22 16:00:00-07',480,'Display fixture shop drawings',  '4c86012d-8a93-41a9-885c-840f6bcfad6b'),
  ('7e000000-0000-0000-0000-000000000002','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','2fff60f1-d914-42a7-bb57-668312d097a4','9b000000-0000-0000-0000-000000000002','5b000000-0000-0000-0000-000000000003','builder','2026-06-23 08:00:00-07','2026-06-23 15:30:00-07',450,'Finalized cut list',            '4c86012d-8a93-41a9-885c-840f6bcfad6b'),
  ('7e000000-0000-0000-0000-000000000003','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','2fff60f1-d914-42a7-bb57-668312d097a4','9b000000-0000-0000-0000-000000000002','5b000000-0000-0000-0000-000000000003','builder','2026-06-25 07:30:00-07','2026-06-25 16:00:00-07',510,'CNC — case parts batch 1',      '1e80fa88-57ab-4324-bd8b-3a23604eb626'),
  ('7e000000-0000-0000-0000-000000000004','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','2fff60f1-d914-42a7-bb57-668312d097a4','9b000000-0000-0000-0000-000000000002','5b000000-0000-0000-0000-000000000003','builder','2026-06-26 08:00:00-07','2026-06-26 14:30:00-07',390,'CNC — case parts batch 2',      '1e80fa88-57ab-4324-bd8b-3a23604eb626'),
  ('7e000000-0000-0000-0000-000000000005','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','2fff60f1-d914-42a7-bb57-668312d097a4','9b000000-0000-0000-0000-000000000003','5b000000-0000-0000-0000-000000000005','builder','2026-06-29 08:00:00-07','2026-06-29 15:00:00-07',420,'Reading room engineering',      '4c86012d-8a93-41a9-885c-840f6bcfad6b'),
  ('7e000000-0000-0000-0000-000000000006','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','2fff60f1-d914-42a7-bb57-668312d097a4','9b000000-0000-0000-0000-000000000003','5b000000-0000-0000-0000-000000000005','builder','2026-06-30 08:00:00-07','2026-06-30 12:30:00-07',270,'Reading room — elevation review','4c86012d-8a93-41a9-885c-840f6bcfad6b')
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- PIECE 8 — INVOICES (open / partial / paid / overdue) + line items
--   Numbers INV-1001..1005 avoid the existing INV-0001/0002.
-- ============================================================================
INSERT INTO client_invoices
  (id, org_id, project_id, client_id, invoice_number, invoice_date, due_date, status, subtotal, tax_pct, tax_amount, total, amount_received, notes, sent_at, paid_at) VALUES
  -- Birch — 50% deposit, open & past due in calendar terms (still 'sent')
  ('1c000000-0000-0000-0000-000000000001','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000002','INV-1001','2026-06-10','2026-06-24','sent',   66000,0,0,66000,0,'50% deposit — retail fixtures','2026-06-10 09:00:00-07',NULL),
  -- Birch — progress billing, partially paid
  ('1c000000-0000-0000-0000-000000000002','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000002','INV-1002','2026-06-20','2026-07-04','partial',33000,0,0,33000,16500,'Progress billing — 25%','2026-06-20 09:00:00-07',NULL),
  -- Library — open invoice
  ('1c000000-0000-0000-0000-000000000003','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000003','INV-1003','2026-06-18','2026-07-02','sent',   48375,0,0,48375,0,'50% deposit — library built-ins','2026-06-18 10:00:00-07',NULL),
  -- Library — older invoice now overdue
  ('1c000000-0000-0000-0000-000000000004','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000003','INV-1004','2026-05-20','2026-06-03','overdue',19350,0,0,19350,0,'Design retainer — past due','2026-05-20 10:00:00-07',NULL),
  -- Westfield — deposit paid in full
  ('1c000000-0000-0000-0000-000000000005','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','INV-1005','2026-06-05','2026-06-19','paid',   25350,0,0,25350,25350,'30% deposit — kitchen & pantry','2026-06-05 09:00:00-07','2026-06-12 14:00:00-07')
ON CONFLICT (id) DO NOTHING;

INSERT INTO client_invoice_line_items
  (id, invoice_id, sort_order, description, quantity, unit, unit_price, amount, source_type) VALUES
  ('11000000-0000-0000-0000-000000000001','1c000000-0000-0000-0000-000000000001',1,'Display fixtures — 50% deposit',1,'lot',66000,66000,'custom'),
  ('11000000-0000-0000-0000-000000000002','1c000000-0000-0000-0000-000000000002',1,'Retail fixtures — progress billing (25%)',1,'lot',33000,33000,'custom'),
  ('11000000-0000-0000-0000-000000000003','1c000000-0000-0000-0000-000000000003',1,'Reading room built-ins — 50% deposit',1,'lot',30500,30500,'custom'),
  ('11000000-0000-0000-0000-000000000004','1c000000-0000-0000-0000-000000000003',2,'Circulation desk — 50% deposit',1,'lot',17875,17875,'custom'),
  ('11000000-0000-0000-0000-000000000005','1c000000-0000-0000-0000-000000000004',1,'Design & engineering retainer',1,'lot',19350,19350,'custom'),
  ('11000000-0000-0000-0000-000000000006','1c000000-0000-0000-0000-000000000005',1,'Kitchen & pantry — 30% deposit',1,'lot',25350,25350,'custom')
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- PIECE 9 — PAYMENTS (for the partial + paid invoices)
-- ============================================================================
INSERT INTO client_invoice_payments
  (id, invoice_id, amount, payment_date, payment_method, reference, notes) VALUES
  ('9a000000-0000-0000-0000-000000000001','1c000000-0000-0000-0000-000000000002',16500,'2026-06-26','ach','BIRCH-ACH-0626','Partial payment received'),
  ('9a000000-0000-0000-0000-000000000002','1c000000-0000-0000-0000-000000000005',25350,'2026-06-12','check','CHK-2041','Deposit paid in full')
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- PIECE 10 — VERIFY (run last; eyeball the counts)
-- ============================================================================
SELECT 'projects (pipeline+jobs)' AS what, count(*) FROM projects WHERE id::text LIKE '9b000000%'
UNION ALL SELECT 'clients',            count(*) FROM clients              WHERE id::text LIKE 'c1000000%'
UNION ALL SELECT 'subprojects',        count(*) FROM subprojects          WHERE id::text LIKE '5b000000%'
UNION ALL SELECT 'dept_allocations',   count(*) FROM department_allocations WHERE id::text LIKE 'a110c000%'
UNION ALL SELECT 'capacity_overrides', count(*) FROM capacity_overrides   WHERE id::text LIKE 'caca0000%'
UNION ALL SELECT 'time_entries',       count(*) FROM time_entries         WHERE id::text LIKE '7e000000%'
UNION ALL SELECT 'invoices',           count(*) FROM client_invoices      WHERE id::text LIKE '1c000000%'
UNION ALL SELECT 'invoice_payments',   count(*) FROM client_invoice_payments WHERE id::text LIKE '9a000000%';


-- ============================================================================
--                      REPORTS PAGE  (run pieces 11–15)
--   Shop grade  = estimating accuracy on project_outcomes (actual vs est hrs).
--   Booked work = sold/production projects with estimate_lines hours + a slot
--                 on the capacity calendar (project_month_allocations).
-- ============================================================================


-- ============================================================================
-- PIECE 11 — COMPLETED projects (feed the shop grade + completed table)
--   stage 'production' + completed_at set. No subprojects/estimate_lines, so
--   they never show up in the booked-work outlook.
-- ============================================================================
INSERT INTO projects (id, org_id, name, stage, client_name, estimated_price, estimated_hours, sold_at, completed_at, due_date, notes) VALUES
  ('9b000000-0000-0000-0000-000000000101','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','Aldridge Kitchen Remodel','production','Greg & Dana Aldridge',58000,220,'2026-03-10 10:00:00-07','2026-06-15 16:00:00-07','2026-06-15','Completed — on estimate.'),
  ('9b000000-0000-0000-0000-000000000102','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','Brookline Library Nook','production','Brookline HOA',39000,160,'2026-03-01 10:00:00-07','2026-06-02 16:00:00-07','2026-06-02','Completed — slightly under hours.'),
  ('9b000000-0000-0000-0000-000000000103','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','Carmichael Vanities','production','Sam Carmichael',23000,90,'2026-04-01 10:00:00-07','2026-05-20 16:00:00-07','2026-05-20','Completed — small job, clean.'),
  ('9b000000-0000-0000-0000-000000000104','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','Donnelly Built-Ins','production','Pat Donnelly',76000,300,'2026-02-15 10:00:00-07','2026-05-05 16:00:00-07','2026-05-05','Completed — 1 change order.'),
  ('9b000000-0000-0000-0000-000000000105','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','Easton Office Casework','production','Easton & Reed LLP',107000,410,'2026-02-01 10:00:00-07','2026-04-22 16:00:00-07','2026-04-22','Completed — 2 change orders.'),
  ('9b000000-0000-0000-0000-000000000106','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','Fairview Reception Desk','production','Fairview Clinic',31000,120,'2026-02-20 10:00:00-07','2026-04-10 16:00:00-07','2026-04-10','Completed — ran over on hours + materials.')
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- PIECE 12 — project_outcomes (the actual grade inputs)
--   5 of 6 within 5% on hours (hits) + 1 overrun → estimating grade ≈ B.
-- ============================================================================
INSERT INTO project_outcomes
  (id, org_id, project_id, estimated_hours, estimated_materials, estimated_price,
   actual_hours, actual_labor_cost, actual_materials, actual_revenue, actual_margin, actual_margin_pct,
   hours_variance, hours_variance_pct, material_variance, material_variance_pct,
   shop_rate_at_completion, utilization_at_completion, headcount_at_completion,
   change_order_count, change_order_revenue, completed_at) VALUES
  ('d00c0000-0000-0000-0000-000000000001','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000101',220,19000,58000, 224,18368,19500,58000,20132,34.7,   4,1.82,  500,2.63,  82,78,10, 0,0,    '2026-06-15 16:00:00-07'),
  ('d00c0000-0000-0000-0000-000000000002','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000102',160,12500,39000, 158,12956,12000,39000,14044,36.0,  -2,-1.25, -500,-4.00, 82,80, 8, 0,0,    '2026-06-02 16:00:00-07'),
  ('d00c0000-0000-0000-0000-000000000003','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000103', 90, 7200,23000,  92, 7544, 7000,23000, 8456,36.8,   2,2.22, -200,-2.78, 82,76, 6, 0,0,    '2026-05-20 16:00:00-07'),
  ('d00c0000-0000-0000-0000-000000000004','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000104',300,27000,76000, 306,25092,28000,82000,28908,35.3,   6,2.00, 1000,3.70,  82,79,10, 1,6000, '2026-05-05 16:00:00-07'),
  ('d00c0000-0000-0000-0000-000000000005','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000105',410,40000,107000,418,34276,41000,116000,40724,35.1,  8,1.95, 1000,2.50,  82,80,11, 2,9000, '2026-04-22 16:00:00-07'),
  ('d00c0000-0000-0000-0000-000000000006','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000106',120,11000,31000, 141,11562,14500,31000, 4938,15.9,  21,17.50,3500,31.82, 82,62, 7, 0,0,    '2026-04-10 16:00:00-07')
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- PIECE 13 — BOOKED hours: estimate_lines for the 3 active jobs' subprojects.
--   dept_hour_overrides is the canonical hours source loadProjectDeptHours
--   reads; per-line totals sum to each subproject's estimated_hours.
-- ============================================================================
INSERT INTO estimate_lines (id, subproject_id, sort_order, description, quantity, unit, dept_hour_overrides) VALUES
  ('e1000000-0000-0000-0000-000000000001','5b000000-0000-0000-0000-000000000001',0,'Kitchen cabinets — shop labor',1,'lot','{"eng":26,"cnc":65,"assembly":91,"finish":52,"install":26}'),
  ('e1000000-0000-0000-0000-000000000002','5b000000-0000-0000-0000-000000000002',0,'Walk-in pantry — shop labor',1,'lot','{"eng":16,"cnc":40,"assembly":56,"finish":32,"install":16}'),
  ('e1000000-0000-0000-0000-000000000003','5b000000-0000-0000-0000-000000000003',0,'Display fixtures — shop labor',1,'lot','{"eng":38,"cnc":95,"assembly":133,"finish":76,"install":38}'),
  ('e1000000-0000-0000-0000-000000000004','5b000000-0000-0000-0000-000000000004',0,'Checkout counters — shop labor',1,'lot','{"eng":23,"cnc":57,"assembly":81,"finish":46,"install":23}'),
  ('e1000000-0000-0000-0000-000000000005','5b000000-0000-0000-0000-000000000005',0,'Reading room built-ins — shop labor',1,'lot','{"eng":32,"cnc":80,"assembly":112,"finish":64,"install":32}'),
  ('e1000000-0000-0000-0000-000000000006','5b000000-0000-0000-0000-000000000006',0,'Circulation desk — shop labor',1,'lot','{"eng":19,"cnc":47,"assembly":67,"finish":38,"install":19}')
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- PIECE 14 — BOOKED timeline: project_month_allocations (capacity calendar).
--   Places each active job in calendar months so the outlook chart can spread
--   its booked hours. Birch lands in Jul; Westfield + Library span Jul–Aug.
-- ============================================================================
INSERT INTO project_month_allocations
  (id, org_id, project_id, month_date, hours_allocated, department_hours, display_order, source) VALUES
  ('ab000000-0000-0000-0000-000000000001','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000001','2026-07-01',210,'{}',0,'manual'),
  ('ab000000-0000-0000-0000-000000000002','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000001','2026-08-01',210,'{}',0,'manual'),
  ('ab000000-0000-0000-0000-000000000003','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000002','2026-07-01',610,'{}',0,'manual'),
  ('ab000000-0000-0000-0000-000000000004','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000003','2026-07-01',255,'{}',0,'manual'),
  ('ab000000-0000-0000-0000-000000000005','85b67e22-ebf4-4d78-94e8-3b1c73ca702f','9b000000-0000-0000-0000-000000000003','2026-08-01',255,'{}',0,'manual')
-- The app auto-creates zero-hour month slots when a job goes sold/production,
-- so conflict on the natural key (project_id, month_date, source), not id.
ON CONFLICT (project_id, month_date, source) DO NOTHING;


-- ============================================================================
-- PIECE 15 — VERIFY reports data
-- ============================================================================
SELECT 'completed projects'   AS what, count(*) FROM projects                 WHERE id::text LIKE '9b000000-0000-0000-0000-0000000001%'
UNION ALL SELECT 'project_outcomes',   count(*) FROM project_outcomes          WHERE id::text LIKE 'd00c0000%'
UNION ALL SELECT 'estimate_lines',     count(*) FROM estimate_lines            WHERE id::text LIKE 'e1000000%'
UNION ALL SELECT 'month_allocations',  count(*) FROM project_month_allocations WHERE id::text LIKE 'ab000000%';
-- Also expect the booked outlook to show 3 projects (Westfield, Birch, Maple Falls).


-- ============================================================================
-- PIECE 99 — CLEANUP (uncomment to remove ALL demo data added above)
-- ============================================================================
-- DELETE FROM project_month_allocations  WHERE id::text LIKE 'ab000000%';
-- DELETE FROM estimate_lines             WHERE id::text LIKE 'e1000000%';
-- DELETE FROM project_outcomes           WHERE id::text LIKE 'd00c0000%';
-- DELETE FROM client_invoice_payments   WHERE id::text LIKE '9a000000%';
-- DELETE FROM client_invoice_line_items  WHERE id::text LIKE '11000000%';
-- DELETE FROM client_invoices            WHERE id::text LIKE '1c000000%';
-- DELETE FROM time_entries               WHERE id::text LIKE '7e000000%';
-- DELETE FROM capacity_overrides         WHERE id::text LIKE 'caca0000%';
-- DELETE FROM department_allocations     WHERE id::text LIKE 'a110c000%';
-- DELETE FROM subprojects                WHERE id::text LIKE '5b000000%';
-- DELETE FROM projects                   WHERE id::text LIKE '9b000000%';
-- DELETE FROM clients                    WHERE id::text LIKE 'c1000000%';
