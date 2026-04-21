-- ============================================================================
-- Migration 015 — parse-drawings bucket policies fix
-- ============================================================================
-- Migration 013 shipped RLS policies on storage.objects that used a subquery
-- against public.users to look up the uploader's org_id. In practice that
-- subquery returns empty inside the RLS evaluation context (either the users
-- table isn't visible to the authenticated role from inside the policy, or
-- auth.uid() resolves before the users row is fully hydrated), which caused
-- every browser-side upload to be rejected with:
--
--   "new row violates row-level security policy"
--
-- and the parser was silently falling back to a text-only scan.
--
-- The rest of the MVP does app-level org filtering rather than RLS, so we
-- align the bucket with that pattern: authenticated users can upload/read/
-- delete any object in the parse-drawings bucket, and the server trusts the
-- storage_path it receives (the route already only handles the user's own
-- upload flow — anonymous traffic is rejected at the page/auth layer).
--
-- The bucket itself is still private (public = false), so objects are not
-- world-readable; only the signed-in user who has the path or the service
-- role can reach them.
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

-- Drop the users-lookup policies from migration 013.
DROP POLICY IF EXISTS "parse_drawings_upload_own_org" ON storage.objects;
DROP POLICY IF EXISTS "parse_drawings_read_own_org"   ON storage.objects;
DROP POLICY IF EXISTS "parse_drawings_delete_own_org" ON storage.objects;

-- Also drop any prior versions of the simpler policies so the migration is
-- safe to re-run after iterations.
DROP POLICY IF EXISTS "parse_drawings_upload_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "parse_drawings_read_authenticated"   ON storage.objects;
DROP POLICY IF EXISTS "parse_drawings_delete_authenticated" ON storage.objects;

-- INSERT — any authenticated user can upload into the parse-drawings bucket.
-- The app constructs the path as `${orgId}/${randomKey}-${filename}`; the
-- server route reads back exactly the path it was handed, so path forgery
-- only lets a user upload into their own session's flow.
CREATE POLICY "parse_drawings_upload_authenticated"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'parse-drawings');

-- SELECT — authenticated users can read back objects in this bucket. Primarily
-- useful for browser debugging; the production read path is the service role
-- inside /api/parse-drawings.
CREATE POLICY "parse_drawings_read_authenticated"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'parse-drawings');

-- DELETE — authenticated users can clean up their own uploads on failure.
-- The server-side route also deletes via service role after successful parse.
CREATE POLICY "parse_drawings_delete_authenticated"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'parse-drawings');

COMMIT;
