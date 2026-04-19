-- ============================================================================
-- MillSuite — Pre-production approval system (Phase 0 seed)
-- ============================================================================
-- Exercises every branch of the schema from 002_preprod_approval_schema.sql
-- so the gate query can be sanity-checked against real data before any UI is
-- built. Creates a "Test Kitchen (preprod seed)" project with two subprojects.
--
-- Idempotent: detects existing seed by project name and skips.
-- Safe to re-run on top of the schema migration.
-- ============================================================================

DO $$
DECLARE
  v_org_id uuid;
  v_project_id uuid;
  v_main_subproject_id uuid;
  v_island_subproject_id uuid;
  v_category_id uuid;
  v_slab_item_id uuid;
  v_walnut_variant_id uuid;
  v_oak_variant_id uuid;
  v_line_1_id uuid;
  v_line_2_id uuid;
  v_line_3_id uuid;
  v_main_exterior_material_slot_id uuid;
  v_main_exterior_finish_slot_id uuid;
  v_main_interior_finish_slot_id uuid;
  v_main_toe_kick_slot_id uuid;
  v_main_custom_pull_slot_id uuid;
  v_island_exterior_material_slot_id uuid;
BEGIN
  -- Skip if the seed project already exists (idempotent re-run).
  IF EXISTS (SELECT 1 FROM projects WHERE name = 'Test Kitchen (preprod seed)') THEN
    RAISE NOTICE 'Preprod approval seed already present — skipping.';
    RETURN;
  END IF;

  -- Pin to the first org in the table. In a fresh DB with no orgs, we create
  -- a demo org on the fly; otherwise we piggy-back on whatever's there.
  SELECT id INTO v_org_id FROM orgs ORDER BY created_at LIMIT 1;
  IF v_org_id IS NULL THEN
    INSERT INTO orgs (name, slug) VALUES ('Preprod Seed Org', 'preprod-seed-org')
      RETURNING id INTO v_org_id;
  END IF;

  -- Project + subprojects.
  INSERT INTO projects (org_id, name, client_name, status, sold_at)
    VALUES (v_org_id, 'Test Kitchen (preprod seed)', 'Seed Client', 'active', now())
    RETURNING id INTO v_project_id;

  INSERT INTO subprojects (project_id, org_id, name, sort_order)
    VALUES (v_project_id, v_org_id, 'Main kitchen', 0)
    RETURNING id INTO v_main_subproject_id;

  INSERT INTO subprojects (project_id, org_id, name, sort_order)
    VALUES (v_project_id, v_org_id, 'Island', 1)
    RETURNING id INTO v_island_subproject_id;

  -- Rate book category (re-use if one already exists named 'Cabinetry').
  SELECT id INTO v_category_id FROM rate_book_categories
    WHERE org_id = v_org_id AND name = 'Cabinetry' LIMIT 1;
  IF v_category_id IS NULL THEN
    INSERT INTO rate_book_categories (org_id, name, item_type)
      VALUES (v_org_id, 'Cabinetry', 'cabinet_style')
      RETURNING id INTO v_category_id;
  END IF;

  -- Rate book item (D1: default callouts drive slot creation).
  INSERT INTO rate_book_items (
    org_id, category_id, name, description, unit,
    base_labor_hours_eng, base_labor_hours_cnc, base_labor_hours_assembly,
    base_labor_hours_finish, base_labor_hours_install,
    sheets_per_unit, sheet_cost, hardware_cost,
    default_callouts
  ) VALUES (
    v_org_id, v_category_id, 'Slab cabinet door', 'Flat panel door, no frame', 'lf',
    0.25, 0.40, 0.60, 0.50, 0.30,
    0.8, 185, 45,
    ARRAY['exterior material', 'exterior finish', 'interior finish']
  ) RETURNING id INTO v_slab_item_id;

  -- Two material variants (D2). Walnut slab is the default.
  INSERT INTO rate_book_material_variants (
    rate_book_item_id, material_name, material_cost_per_lf
  ) VALUES (
    v_slab_item_id, 'Walnut slab', 48.00
  ) RETURNING id INTO v_walnut_variant_id;

  INSERT INTO rate_book_material_variants (
    rate_book_item_id, material_name, material_cost_per_lf,
    labor_multiplier_eng
  ) VALUES (
    v_slab_item_id, 'White oak rift (chevron)', 62.00,
    1.25  -- chevron veneer adds engineering time
  ) RETURNING id INTO v_oak_variant_id;

  UPDATE rate_book_items
    SET default_variant_id = v_walnut_variant_id
    WHERE id = v_slab_item_id;

  -- Estimate lines on Main kitchen. Line 1 overrides callouts; lines 2-3
  -- inherit from the rate book item default.
  INSERT INTO estimate_lines (
    subproject_id, sort_order, description,
    rate_book_item_id, rate_book_material_variant_id,
    quantity, linear_feet, callouts
  ) VALUES (
    v_main_subproject_id, 0, 'Upper cabinets — door faces',
    v_slab_item_id, v_walnut_variant_id,
    1, 18, ARRAY['exterior material', 'exterior finish']  -- override: no interior callout on uppers
  ) RETURNING id INTO v_line_1_id;

  INSERT INTO estimate_lines (
    subproject_id, sort_order, description,
    rate_book_item_id, rate_book_material_variant_id,
    quantity, linear_feet
  ) VALUES (
    v_main_subproject_id, 1, 'Lower cabinets — door faces',
    v_slab_item_id, v_walnut_variant_id,
    1, 22  -- callouts NULL = inherit default_callouts
  ) RETURNING id INTO v_line_2_id;

  INSERT INTO estimate_lines (
    subproject_id, sort_order, description,
    rate_book_item_id, rate_book_material_variant_id,
    quantity, linear_feet
  ) VALUES (
    v_main_subproject_id, 2, 'Pantry — door faces',
    v_slab_item_id, v_walnut_variant_id,
    1, 8  -- callouts NULL = inherit
  ) RETURNING id INTO v_line_3_id;

  -- Approval items on Main kitchen.
  -- 1. Exterior material — pending, ball in shop's court (waiting on sample prep).
  INSERT INTO approval_items (
    subproject_id, source_estimate_line_id, label,
    rate_book_item_id, rate_book_material_variant_id,
    material, finish, state, last_state_change_at, ball_in_court
  ) VALUES (
    v_main_subproject_id, v_line_1_id, 'exterior material',
    v_slab_item_id, v_walnut_variant_id,
    'Walnut slab', NULL, 'pending', now() - interval '1 day', 'shop'
  ) RETURNING id INTO v_main_exterior_material_slot_id;

  -- 2. Exterior finish — in review, ball in client's court (sample sent).
  INSERT INTO approval_items (
    subproject_id, source_estimate_line_id, label,
    rate_book_item_id, rate_book_material_variant_id,
    material, finish, state, last_state_change_at, ball_in_court
  ) VALUES (
    v_main_subproject_id, v_line_1_id, 'exterior finish',
    v_slab_item_id, v_walnut_variant_id,
    'Walnut slab', 'Rubio Pure', 'in_review', now() - interval '4 days', 'client'
  ) RETURNING id INTO v_main_exterior_finish_slot_id;

  -- 3. Interior finish — approved, no ball.
  INSERT INTO approval_items (
    subproject_id, source_estimate_line_id, label,
    rate_book_item_id, rate_book_material_variant_id,
    material, finish, state, last_state_change_at
  ) VALUES (
    v_main_subproject_id, v_line_2_id, 'interior finish',
    v_slab_item_id, v_walnut_variant_id,
    'Pre-finished maple ply', 'Matte clear', 'approved', now() - interval '2 days'
  ) RETURNING id INTO v_main_interior_finish_slot_id;

  -- 4. Custom slot WITH baseline — metal toe kick (D7).
  INSERT INTO approval_items (
    subproject_id, label,
    material, finish, is_custom,
    custom_material_cost_per_lf,
    custom_labor_hours_eng, custom_labor_hours_cnc,
    custom_labor_hours_assembly, custom_labor_hours_finish, custom_labor_hours_install,
    state, last_state_change_at, ball_in_court
  ) VALUES (
    v_main_subproject_id, 'metal toe kick',
    'Blackened steel', 'Clear matte lacquer', true,
    85.00,
    0.50, 0.30, 0.40, 0.60, 0.20,
    'pending', now() - interval '5 days', 'shop'
  ) RETURNING id INTO v_main_toe_kick_slot_id;

  -- 5. Custom slot WITHOUT baseline — CO repricing will refuse auto-diff (D7).
  INSERT INTO approval_items (
    subproject_id, label, material, finish, is_custom,
    state, last_state_change_at, ball_in_court
  ) VALUES (
    v_main_subproject_id, 'custom pull',
    'Solid brass knurled pull', NULL, true,
    'pending', now(), 'shop'
  ) RETURNING id INTO v_main_custom_pull_slot_id;

  -- Approval items on Island: linked exterior material (D4).
  INSERT INTO approval_items (
    subproject_id, label,
    rate_book_item_id, rate_book_material_variant_id,
    material, finish, linked_to_item_id,
    state, last_state_change_at, ball_in_court
  ) VALUES (
    v_island_subproject_id, 'exterior material',
    v_slab_item_id, v_walnut_variant_id,
    'Walnut slab', NULL, v_main_exterior_material_slot_id,
    'pending', now() - interval '1 day', 'shop'
  ) RETURNING id INTO v_island_exterior_material_slot_id;

  -- Item revisions: sample submitted on exterior finish 4 days ago.
  INSERT INTO item_revisions (approval_item_id, action, note, occurred_at)
    VALUES (
      v_main_exterior_finish_slot_id, 'submitted',
      'Rubio Pure sample shipped via FedEx, tracking 12345',
      now() - interval '4 days'
    );

  -- Drawing revisions on Main kitchen: rev 1 superseded (approved), rev 2 latest (in review).
  INSERT INTO drawing_revisions (
    subproject_id, revision_number, file_url, state, is_latest,
    submitted_at, responded_at, notes
  ) VALUES (
    v_main_subproject_id, 1, 'https://example.com/drawings/main-kitchen-r1.pdf',
    'approved', false,
    now() - interval '10 days', now() - interval '7 days',
    'Initial layout — approved, superseded by R2 after client added pantry extension'
  );

  INSERT INTO drawing_revisions (
    subproject_id, revision_number, file_url, state, is_latest,
    submitted_at, notes
  ) VALUES (
    v_main_subproject_id, 2, 'https://example.com/drawings/main-kitchen-r2.pdf',
    'in_review', true,
    now() - interval '2 days',
    'Added pantry extension per change request'
  );

  RAISE NOTICE 'Preprod approval seed inserted under org %. Project: Test Kitchen (preprod seed).', v_org_id;
  RAISE NOTICE 'Run the gate query to verify:';
  RAISE NOTICE '  SELECT * FROM subproject_approval_status WHERE subproject_id IN (%, %);',
    v_main_subproject_id, v_island_subproject_id;
END $$;

-- ============================================================================
-- Expected gate-query results:
--
-- Main kitchen:
--   ready_for_scheduling = FALSE
--   slots_total = 5, slots_approved = 1
--   latest_drawing_revisions = 1, latest_drawings_approved = 0
--   open_change_orders = 0, approved_co_net_change = 0
--
-- Island:
--   ready_for_scheduling = FALSE
--   slots_total = 1, slots_approved = 0
--   latest_drawing_revisions = 0 (no drawings uploaded yet)
--   latest_drawings_approved = 0
--
-- Both subprojects should be gated. Neither is ready for scheduling.
-- ============================================================================
