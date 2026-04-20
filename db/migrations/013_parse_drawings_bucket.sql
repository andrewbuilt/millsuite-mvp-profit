-- ============================================================================
-- Migration 013 — parse-drawings storage bucket
-- ============================================================================
-- /api/parse-drawings accepts PDFs up to ~32 MB. We can't ship them through a
-- JSON request body because Vercel caps serverless bodies at 4.5 MB. Instead
-- the browser uploads the PDF to this private bucket and POSTs just the path;
-- the server reads it back with the service role, streams it to Claude, then
-- deletes it.
--
-- The bucket is private (no public RLS) and the service-role client is the
-- only consumer, so no additional storage policies are required for reads.
-- We *do* need an INSERT policy so the browser (authenticated user) can put
-- the file in to begin with — scoped to their own org prefix so one shop
-- can't see another's uploads.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

-- 1. Create the bucket (private; 40 MB per-object cap matches the UI hint).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'parse-drawings',
  'parse-drawings',
  false,
  41943040,                                   -- 40 MB
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit   = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      public             = EXCLUDED.public;

-- 2. Allow authenticated users to upload under {orgId}/... paths. The route
--    handler validates org membership before delete, so we trust the first
--    path segment here for insert-only.
--
--    NOTE: users.id is the app-level user id; users.auth_user_id is the
--    Supabase-auth uid. auth.uid() returns the latter — matching how every
--    other RLS check in the app resolves the current user's org.
DROP POLICY IF EXISTS "parse_drawings_upload_own_org" ON storage.objects;
CREATE POLICY "parse_drawings_upload_own_org"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'parse-drawings'
    AND (storage.foldername(name))[1] IN (
      SELECT u.org_id::text
        FROM users u
       WHERE u.auth_user_id = auth.uid()
    )
  );

-- 3. Allow authenticated users to read back their own upload (the server
--    reads with service role, but this makes browser debugging easier and
--    matches other buckets in the app).
DROP POLICY IF EXISTS "parse_drawings_read_own_org" ON storage.objects;
CREATE POLICY "parse_drawings_read_own_org"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'parse-drawings'
    AND (storage.foldername(name))[1] IN (
      SELECT u.org_id::text
        FROM users u
       WHERE u.auth_user_id = auth.uid()
    )
  );

-- 4. Allow users to delete their own org's uploads so the browser-side
--    cleanup path (on API failure) works without falling back to silent
--    orphans.
DROP POLICY IF EXISTS "parse_drawings_delete_own_org" ON storage.objects;
CREATE POLICY "parse_drawings_delete_own_org"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'parse-drawings'
    AND (storage.foldername(name))[1] IN (
      SELECT u.org_id::text
        FROM users u
       WHERE u.auth_user_id = auth.uid()
    )
  );

COMMIT;
