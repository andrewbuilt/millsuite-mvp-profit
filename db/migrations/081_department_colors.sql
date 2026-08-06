-- ============================================================================
-- 081 — distinct department colours (fix list 2, item 2)
-- ============================================================================
-- Two halves of the same bug:
--
-- 1. The signup seed inserts the canonical 5 departments WITHOUT a colour, so
--    they all take the column default (#6B7280 grey). Every new shop starts
--    with five identically-coloured departments. 66 rows across the prod DB
--    are still sitting on that default.
--
-- 2. /team picked a new department's colour with
--    `DEPT_COLORS[departments.length % 8]`. Counting breaks as soon as a
--    department is deleted — the length drops back and the next add reuses a
--    colour (and a display_order) that's still in use. Built ended up with
--    FOUR departments all #06B6D4 and all at display_order 5, which also made
--    their ordering arbitrary. The app-side fix (pick the first unused colour,
--    max(display_order)+1) ships with this migration.
--
-- Repair below is convergent: running it twice produces identical values, so
-- it's safe to re-run. It only touches orgs that actually have a collision.
--
-- Rollback: colours are cosmetic; no rollback provided. The function can be
-- restored from 055_free_trial.sql.
-- ============================================================================

BEGIN;

-- ── 1. Seed the canonical 5 with distinct colours ───────────────────────────
-- Same function as 055 (the 8-arg signature; 053's 6-arg version was dropped
-- there) with `color` added to the departments insert. Nothing else changes.

CREATE OR REPLACE FUNCTION public.create_org_with_owner(
  p_auth_user_id uuid,
  p_email        text,
  p_shop_name    text,
  p_plan         text,
  p_seats        int,
  p_base_slug    text,
  p_plan_status  text        DEFAULT 'pending',
  p_trial_ends_at timestamptz DEFAULT NULL
)
RETURNS TABLE (org_id uuid, user_id uuid, slug text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id  uuid;
  v_user_id uuid;
  v_slug    text := p_base_slug;
  v_attempt int  := 0;
BEGIN
  LOOP
    BEGIN
      INSERT INTO public.orgs (
        name, slug, plan, plan_status, trial_ends_at, seats,
        consumable_markup_pct, labor_margin_pct, material_margin_pct, consumable_margin_pct
      )
      VALUES (
        p_shop_name, v_slug, p_plan, p_plan_status, p_trial_ends_at, GREATEST(p_seats, 1),
        10, 35, 35, 35
      )
      RETURNING id INTO v_org_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_attempt := v_attempt + 1;
      IF v_attempt >= 5 THEN
        RAISE;
      END IF;
      v_slug := left(p_base_slug || '-' || substr(md5(random()::text), 1, 4), 50);
    END;
  END LOOP;

  INSERT INTO public.users (org_id, auth_user_id, email, name, role)
  VALUES (v_org_id, p_auth_user_id, p_email, p_shop_name, 'owner')
  RETURNING id INTO v_user_id;

  UPDATE public.orgs SET owner_id = v_user_id WHERE id = v_org_id;

  INSERT INTO public.shop_rate_settings (org_id) VALUES (v_org_id);

  -- Colours match DEPT_COLORS in app/(app)/team/page.tsx, in order.
  INSERT INTO public.departments (org_id, name, display_order, active, hours_per_day, color)
  VALUES
    (v_org_id, 'Engineering', 1, true, 8, '#3B82F6'),
    (v_org_id, 'CNC',         2, true, 8, '#8B5CF6'),
    (v_org_id, 'Assembly',    3, true, 8, '#10B981'),
    (v_org_id, 'Finish',      4, true, 8, '#F59E0B'),
    (v_org_id, 'Install',     5, true, 8, '#EF4444');

  RETURN QUERY SELECT v_org_id, v_user_id, v_slug;
END;
$$;

-- ── 2. Repair existing orgs ─────────────────────────────────────────────────
-- Ordering key is (canonical workflow position, display_order, created_at,
-- name) so the result is stable even where display_order is duplicated.

-- 2a. Duplicate display_order → renumber 1..n.
WITH ranked AS (
  SELECT id, org_id,
         row_number() OVER (
           PARTITION BY org_id
           ORDER BY
             -- Canonical workflow order first (same name matching the app uses
             -- to map a department to a labour dept), then whatever intent the
             -- existing values carry. Only colliding orgs are touched, and
             -- their order is already arbitrary, so this is a strict upgrade.
             CASE
               WHEN lower(name) LIKE 'eng%'     THEN 1
               WHEN lower(name) LIKE 'cnc%'     THEN 2
               WHEN lower(name) LIKE 'assembl%' THEN 3
               WHEN lower(name) LIKE 'finish%'  THEN 4
               WHEN lower(name) LIKE 'install%' THEN 5
               ELSE 99
             END,
             display_order NULLS LAST, created_at, name
         ) AS rn
  FROM public.departments
),
colliding AS (
  SELECT org_id
  FROM public.departments
  GROUP BY org_id
  HAVING count(*) <> count(DISTINCT display_order)
)
UPDATE public.departments d
SET display_order = r.rn
FROM ranked r
WHERE d.id = r.id
  AND d.org_id IN (SELECT org_id FROM colliding)
  AND d.display_order IS DISTINCT FROM r.rn;

-- 2b. Duplicate or missing colours → assign from the palette in order.
WITH ranked AS (
  SELECT id, org_id,
         row_number() OVER (
           PARTITION BY org_id
           ORDER BY
             -- Canonical workflow order first (same name matching the app uses
             -- to map a department to a labour dept), then whatever intent the
             -- existing values carry. Only colliding orgs are touched, and
             -- their order is already arbitrary, so this is a strict upgrade.
             CASE
               WHEN lower(name) LIKE 'eng%'     THEN 1
               WHEN lower(name) LIKE 'cnc%'     THEN 2
               WHEN lower(name) LIKE 'assembl%' THEN 3
               WHEN lower(name) LIKE 'finish%'  THEN 4
               WHEN lower(name) LIKE 'install%' THEN 5
               ELSE 99
             END,
             display_order NULLS LAST, created_at, name
         ) AS rn
  FROM public.departments
),
colliding AS (
  SELECT org_id
  FROM public.departments
  GROUP BY org_id
  HAVING count(*) <> count(DISTINCT color)   -- count(DISTINCT) skips NULLs, so
                                             -- a missing colour also lands here
)
UPDATE public.departments d
SET color = (ARRAY[
      '#3B82F6', '#8B5CF6', '#10B981', '#F59E0B',
      '#EF4444', '#06B6D4', '#EC4899', '#6B7280'
    ])[((r.rn - 1) % 8) + 1]
FROM ranked r
WHERE d.id = r.id
  AND d.org_id IN (SELECT org_id FROM colliding)
  AND d.color IS DISTINCT FROM (ARRAY[
      '#3B82F6', '#8B5CF6', '#10B981', '#F59E0B',
      '#EF4444', '#06B6D4', '#EC4899', '#6B7280'
    ])[((r.rn - 1) % 8) + 1];

NOTIFY pgrst, 'reload schema';

COMMIT;
