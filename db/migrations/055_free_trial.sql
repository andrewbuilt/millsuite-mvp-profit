-- ============================================================================
-- 055 — Free trial (30-day, no-card, base/Profit tier)
-- ============================================================================
-- The base tier (plan='starter') now starts with a 30-day app-managed trial
-- instead of pay-immediately. "App-managed" = there is NO Stripe
-- subscription during the trial (no card collected); access is granted by
-- plan_status='trialing' while now() < trial_ends_at. When the trial ends,
-- the gate flips them to "subscribe to continue" → /api/checkout (which is
-- where a card is finally collected). Pro / Pro+ keep pay-immediately.
--
-- Changes:
--   - orgs.trial_ends_at: when the no-card trial expires (NULL = not on a
--     trial). plan_status='trialing' is the access-granting state until then.
--   - create_org_with_owner(): gains p_plan_status + p_trial_ends_at so
--     /api/auth/setup can seed a trial org atomically (base tier) or a
--     pending org (paid tiers) in the same one-shot call.
--
-- Rollback:
--   ALTER TABLE public.orgs DROP COLUMN IF EXISTS trial_ends_at;
--   (and restore the migration-053 signature of create_org_with_owner)
-- ============================================================================

BEGIN;

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz NULL;

-- Replacing the function signature (adding params) requires a DROP — a bare
-- CREATE OR REPLACE can't change the argument list.
DROP FUNCTION IF EXISTS public.create_org_with_owner(uuid, text, text, text, int, text);

CREATE FUNCTION public.create_org_with_owner(
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
