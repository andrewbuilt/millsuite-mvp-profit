-- ============================================================================
-- 053 — create_org_with_owner() atomic signup function
-- ============================================================================
-- /api/auth/setup used to create the org, then the user, then patch
-- owner_id, then seed shop_rate_settings + departments — as four separate
-- statements with no transaction. If the user insert (or any later step)
-- failed, the org row was left orphaned, and because the route's dedupe
-- check only looked at the users table, a retry created a SECOND org
-- rather than recovering the first. That's the same duplicate-row class
-- of bug that bit billing (#116).
--
-- This function does the whole thing in ONE transaction (plpgsql function
-- bodies are atomic — any failure rolls the entire thing back, so there
-- are no orphan orgs and retries can't pile up partial state). Slug
-- collision handling (PR #117) moves in here too: it retries the org
-- insert with a random suffix, each attempt in its own subtransaction.
--
-- Pricing defaults (10% consumables + 35% per-bucket margins) are seeded
-- explicitly so a new org is never NULL — matches /api/auth/setup (M3).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.create_org_with_owner(uuid, text, text, text, int, text);
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.create_org_with_owner(
  p_auth_user_id uuid,
  p_email        text,
  p_shop_name    text,
  p_plan         text,
  p_seats        int,
  p_base_slug    text
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
  -- Insert the org, retrying with a random slug suffix on collision.
  LOOP
    BEGIN
      INSERT INTO public.orgs (
        name, slug, plan, plan_status, seats,
        consumable_markup_pct, labor_margin_pct, material_margin_pct, consumable_margin_pct
      )
      VALUES (
        p_shop_name, v_slug, p_plan, 'pending', GREATEST(p_seats, 1),
        10, 35, 35, 35
      )
      RETURNING id INTO v_org_id;
      EXIT;  -- success
    EXCEPTION WHEN unique_violation THEN
      v_attempt := v_attempt + 1;
      IF v_attempt >= 5 THEN
        RAISE;  -- give up after 5 tries; caller surfaces the error
      END IF;
      v_slug := left(p_base_slug || '-' || substr(md5(random()::text), 1, 4), 50);
    END;
  END LOOP;

  -- Owner user.
  INSERT INTO public.users (org_id, auth_user_id, email, name, role)
  VALUES (v_org_id, p_auth_user_id, p_email, p_shop_name, 'owner')
  RETURNING id INTO v_user_id;

  UPDATE public.orgs SET owner_id = v_user_id WHERE id = v_org_id;

  -- Default shop rate settings row.
  INSERT INTO public.shop_rate_settings (org_id) VALUES (v_org_id);

  -- Canonical 5 departments (8h/day). Settings can toggle these later.
  INSERT INTO public.departments (org_id, name, display_order, active, hours_per_day)
  VALUES
    (v_org_id, 'Engineering', 1, true, 8),
    (v_org_id, 'CNC',         2, true, 8),
    (v_org_id, 'Assembly',    3, true, 8),
    (v_org_id, 'Finish',      4, true, 8),
    (v_org_id, 'Install',     5, true, 8);

  RETURN QUERY SELECT v_org_id, v_user_id, v_slug;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
