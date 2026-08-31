-- ============================================================================
-- 092 — client portal (v1)
-- ============================================================================
-- Everything the public, token-gated client portal needs, in one additive,
-- idempotent migration. Four independent pieces:
--
--   1. clients.portal_token      — the access key ("the link is the key")
--   2. project_photos            — the "From the shop" feed
--   3. shop-photos bucket        — where those photos live
--   4. projects.finishing_at     — the manual "Finishing" phase toggle
--   5. change_orders signature   — typed-name signing from the portal
--
-- ── Why the token lives on `clients`, not a `portal_tokens` table ───────────
-- Access is per CLIENT, not per project (Andrew's call, 2026-08-31): one link
-- lists every project that client has with the shop. A separate table would
-- buy multi-token / expiry / audit, none of which v1 wants. One column is
-- revocable and regenerable by overwriting it, which is the whole requirement.
-- If per-project or expiring links ever land, promote this to a table then.
--
-- ⛔ The token is a bearer credential. It is UNIQUE and indexed so lookup is a
-- single point read, and it is deliberately NOT NOT-NULL — a client with no
-- token has no portal, which is the correct default for the ~every existing
-- row. Tokens are minted in app code (crypto.randomBytes), never guessed from
-- the client id.
--
-- ⛔ NO RLS POLICY GRANTS THE ANON KEY ACCESS TO ANY OF THIS. The portal reads
-- exclusively through server routes on the service role, behind an explicit
-- field allowlist (lib/client-portal.ts). A policy letting `anon` read by
-- token would put the whole clients row one crafted PostgREST query away.
--
-- Run against prod Supabase before deploying the code that needs it.
-- ============================================================================

BEGIN;

-- ── 1. Portal access token ──────────────────────────────────────────────────

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS portal_token           text NULL,
  ADD COLUMN IF NOT EXISTS portal_token_issued_at timestamptz NULL;

-- Partial unique index: many clients legitimately have NULL, exactly one may
-- hold any given token.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_portal_token
  ON public.clients(portal_token)
  WHERE portal_token IS NOT NULL;

-- ── 2. Shop photo feed ──────────────────────────────────────────────────────
-- org_id is carried explicitly (not joined through projects) so the RLS policy
-- is a plain column compare and the storage path can be derived without a
-- second read.

CREATE TABLE IF NOT EXISTS public.project_photos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  storage_path text NOT NULL,          -- {org_id}/{project_id}/{uuid}.{ext}
  caption      text NULL,
  taken_on     date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- The portal feed is "newest first, per project" — this index is that query.
CREATE INDEX IF NOT EXISTS idx_project_photos_project
  ON public.project_photos(project_id, taken_on DESC, created_at DESC);

ALTER TABLE public.project_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_photos_own_org ON public.project_photos;
CREATE POLICY project_photos_own_org ON public.project_photos
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

-- ── 3. shop-photos storage bucket ───────────────────────────────────────────
-- PUBLIC read, matching invoice-pdfs and org-logos. The portal is itself a
-- public page, and it already links straight at public invoice-pdfs URLs for
-- estimates and change orders — a private bucket here would buy nothing while
-- costing a signed-URL round trip per image. Paths carry two uuids, so they
-- aren't enumerable.
--
-- Uploads go through the service role (POST /api/projects/[id]/photos), so no
-- storage RLS policy is needed — same shape as org-logos.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'shop-photos',
  'shop-photos',
  true,
  10485760,
  ARRAY['image/png','image/jpeg','image/jpg','image/webp','image/heic','image/heif']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── 4. The "Finishing" phase ────────────────────────────────────────────────
-- The client-facing rail has 7 phases; the stored `stage` enum jumps straight
-- from 'production' to 'installed', so phase 5 has nothing behind it. Andrew's
-- call (2026-08-31): a manual toggle on the internal project page rather than
-- deriving it from schedule allocations, which can be wrong and can't be
-- corrected. Nullable timestamp — NULL means "not in finishing yet".
--
-- This is display-only. It does NOT gate production, scheduling, invoicing, or
-- anything else; `stage` remains the single source of truth for the app.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS finishing_at timestamptz NULL;

-- ── 5. Change-order signature ───────────────────────────────────────────────
-- The client signs in the portal by typing their name. These three columns are
-- the signature record; the countersigned PDF is rendered to the invoice-pdfs
-- bucket and its URL cached on signed_pdf_url so the Documents list can link it
-- without re-rendering.

ALTER TABLE public.change_orders
  ADD COLUMN IF NOT EXISTS signed_name    text NULL,
  ADD COLUMN IF NOT EXISTS signed_at      timestamptz NULL,
  ADD COLUMN IF NOT EXISTS signed_ip      text NULL,
  ADD COLUMN IF NOT EXISTS signed_pdf_url text NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
