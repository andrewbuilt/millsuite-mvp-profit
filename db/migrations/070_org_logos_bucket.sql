-- ============================================================================
-- 070 — org-logos storage bucket (public, image mime types)
-- ============================================================================
-- The org logo can't live in the invoice-pdfs bucket (that bucket restricts
-- uploads to application/pdf). A dedicated public bucket for logos: public read
-- (served via getPublicUrl for the header / logins / PDF <Image>), image mime
-- types only, 2 MB cap. Uploads happen via the service role (POST /api/org/logo)
-- so no storage RLS policy is needed. Idempotent.
--
-- Run against prod Supabase before deploying (or create the bucket in the
-- dashboard: Storage → New bucket → name "org-logos", Public).
-- ============================================================================

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'org-logos',
  'org-logos',
  true,
  2097152,
  ARRAY['image/png','image/jpeg','image/jpg','image/webp','image/gif','image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;
