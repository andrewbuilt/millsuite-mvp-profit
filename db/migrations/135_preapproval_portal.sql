-- ============================================================================
-- 135 — B2B pre-approval portal + pre-pro type grouping (scoped 2026-11-24)
-- ============================================================================
-- Everything the per-PROJECT, link-is-the-key approval portal (/p/{token})
-- needs, in one additive, idempotent migration:
--
--   1. approval_items.item_kind / link_url   — Finish / Hardware / Drawing /
--      Other grouping (portal + pre-pro share it one-to-one) + a hardware link
--   2. approval_item_photos + private bucket — finish photos, shop or client
--   3. projects.portal_token (+ issued_at), lead_time_weeks,
--      portal_last_notified_at             — per-project link, lead time,
--                                             and the notify-first queue stamp
--   4. portal_questions                     — client questions + shop answers
--   5. item_revisions.actor_name,
--      drawing_revisions.responded_by_name  — the TYPED NAME of whoever
--      approved / asked for a change in the portal. A client has no users row,
--      so actor_user_id can't carry it; without these the audit trail would
--      have to parse a name back out of a free-text note.
--
-- ⛔ NO RLS POLICY GRANTS THE ANON KEY ACCESS TO ANY OF THIS (standing rule,
-- same as 092). The portal reads and writes only through server routes on the
-- service role, behind an explicit field allowlist (lib/preapproval-portal.ts).
-- Both new tables get RLS ON with an authenticated own-org policy and nothing
-- else; the bucket is PRIVATE with no storage policy (signed URLs only).
-- `projects.portal_token` rides the existing projects policy — authenticated
-- own-org only, never anon. Prove it: `node scripts/rls-audit.mjs`.
--
-- Run against prod Supabase BEFORE deploying the code that needs it.
-- ============================================================================

BEGIN;

-- ── 1. Type grouping on approval items ──────────────────────────────────────
-- The backfill runs ONLY in the same pass that adds the column, so re-running
-- this file never re-classifies an item someone deliberately set to 'other'.

DO $$
DECLARE
  fresh boolean;
BEGIN
  SELECT NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'approval_items' AND column_name = 'item_kind'
  ) INTO fresh;

  IF fresh THEN
    ALTER TABLE public.approval_items
      ADD COLUMN item_kind text NOT NULL DEFAULT 'other'
      CHECK (item_kind IN ('finish', 'hardware', 'drawing', 'other'));

    -- Mirrors lib/approval-kind.ts guessItemKind — keep the two in step.
    -- Order matters: a hardware word in the LABEL wins ("Pulls · satin nickel
    -- finish" is hardware), then finish/material words, then drawings, then a
    -- hardware word in the detail text, then "it has a finish at all".
    UPDATE public.approval_items SET item_kind = CASE
      WHEN label ~* '(pull|knob|handle|hinge|slide|glide|hardware|latch|lock|blum|hettich|salice|grass)' THEN 'hardware'
      WHEN label ~* '(finish|paint|stain|sheen|colou?r|lacquer|veneer|laminate|plam|material|species|countertop|quartz|stone)' THEN 'finish'
      WHEN label ~* '(drawing|shop dwg|elevation|submittal)' THEN 'drawing'
      WHEN coalesce(material, '') ~* '(pull|knob|handle|hinge|slide|glide|blum|hettich|salice)' THEN 'hardware'
      WHEN nullif(btrim(coalesce(finish, '')), '') IS NOT NULL THEN 'finish'
      ELSE 'other'
    END;
  END IF;
END $$;

ALTER TABLE public.approval_items
  ADD COLUMN IF NOT EXISTS link_url text NULL;

COMMENT ON COLUMN public.approval_items.item_kind IS
  'finish | hardware | drawing | other — the group this callout sits in on pre-production and the client portal. (135)';

-- ── 2. Finish photos ────────────────────────────────────────────────────────
-- org_id carried explicitly (approval_items has none) so the RLS policy is a
-- plain column compare. added_by is a display NAME — a roster name for the
-- shop, the typed name for a client — not an id: clients have no users row.

CREATE TABLE IF NOT EXISTS public.approval_item_photos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  approval_item_id uuid NOT NULL REFERENCES public.approval_items(id) ON DELETE CASCADE,
  storage_path     text NOT NULL,          -- {org_id}/{project_id}/{item_id}/{uuid}.{ext}
  caption          text NULL,
  added_by         text NULL,
  -- true = uploaded through the portal by the client; false = by the shop.
  from_client      boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_item_photos_item
  ON public.approval_item_photos(approval_item_id, created_at);

ALTER TABLE public.approval_item_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approval_item_photos_own_org ON public.approval_item_photos;
CREATE POLICY approval_item_photos_own_org ON public.approval_item_photos
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- PRIVATE bucket, unlike shop-photos: these are a client's finish samples on a
-- page with an unguessable link, and a public bucket would outlive a reissued
-- token. No storage policy — every read is a service-role signed URL and
-- every write a service-role route.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'approval-photos',
  'approval-photos',
  false,
  10485760,
  ARRAY['image/png','image/jpeg','image/jpg','image/webp','image/heic','image/heif']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 3. Per-project portal link, lead time, notify stamp ─────────────────────
-- Same pattern as 092's clients.portal_token, but PER PROJECT. The token is a
-- bearer credential: nullable (no token = no portal), unique where set, minted
-- in app code (crypto.randomBytes). Reissuing overwrites it, which dead-links
-- every URL already sent — that is the revoke story.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS portal_token            text NULL,
  ADD COLUMN IF NOT EXISTS portal_token_issued_at  timestamptz NULL,
  ADD COLUMN IF NOT EXISTS lead_time_weeks         numeric NULL,
  ADD COLUMN IF NOT EXISTS portal_last_notified_at timestamptz NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_portal_token
  ON public.projects(portal_token)
  WHERE portal_token IS NOT NULL;

COMMENT ON COLUMN public.projects.lead_time_weeks IS
  'Typed per project; shown to the client on the approval portal. NULL hides the lead-time callout. (135)';
COMMENT ON COLUMN public.projects.portal_last_notified_at IS
  'When the shop last sent the "portal updates" email. Changes after this collect on the pre-production queue. (135)';

-- ── 4. Client questions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.portal_questions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  body         text NOT NULL,
  author_name  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  answer       text NULL,
  answered_by  uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  answered_at  timestamptz NULL,
  -- The task the question created, so the pre-production thread can close it.
  -- SET NULL: deleting the task must not delete the client's question.
  task_id      uuid NULL REFERENCES public.tasks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_portal_questions_project
  ON public.portal_questions(project_id, created_at);

ALTER TABLE public.portal_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS portal_questions_own_org ON public.portal_questions;
CREATE POLICY portal_questions_own_org ON public.portal_questions
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- ── 5. The typed name on the audit trail ────────────────────────────────────

ALTER TABLE public.item_revisions
  ADD COLUMN IF NOT EXISTS actor_name text NULL;

ALTER TABLE public.drawing_revisions
  ADD COLUMN IF NOT EXISTS responded_by_name text NULL;

COMMENT ON COLUMN public.item_revisions.actor_name IS
  'Name typed by the client when they approved / requested a change in the portal. NULL = done in the app. (135)';
COMMENT ON COLUMN public.drawing_revisions.responded_by_name IS
  'Name typed by the client when they approved / requested a change in the portal. NULL = marked in the app. (135)';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ── Eyeball the backfill (run separately, read-only) ────────────────────────
--   SELECT item_kind, count(*) FROM public.approval_items
--   WHERE dismissed_at IS NULL GROUP BY 1 ORDER BY 2 DESC;
--   SELECT item_kind, label, material, finish FROM public.approval_items
--   WHERE dismissed_at IS NULL ORDER BY item_kind, label LIMIT 200;
