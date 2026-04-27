-- ============================================================================
-- 042 — invoice-pdfs storage bucket
-- ============================================================================
-- Public bucket for cached client-invoice PDFs. The /api/invoices/[id]/pdf
-- route renders with @react-pdf/renderer, uploads with the service role to
-- ${org_id}/${invoice_id}.pdf, and stores the public URL on
-- client_invoices.pdf_url. The URL is unguessable (uuid path), so V1
-- treats it as a shareable secret. V2 may move to signed URLs if shops
-- ask for stricter control.
--
-- Service role bypasses RLS, so the API route doesn't need an INSERT
-- policy. The policies below cover any browser-side flows that may
-- show up later (preview-and-upload, client-side regen, manual delete).
--
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'invoice-pdfs',
  'invoice-pdfs',
  true,
  10485760,                                   -- 10 MB; invoice PDFs run a few hundred KB
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      public             = EXCLUDED.public;

-- Authenticated users can upload PDFs into their org's prefix. The
-- service role does the work today; this policy preserves the option
-- for browser-side upload later.
DROP POLICY IF EXISTS "invoice_pdfs_upload_own_org" ON storage.objects;
CREATE POLICY "invoice_pdfs_upload_own_org"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'invoice-pdfs'
    AND (storage.foldername(name))[1] IN (
      SELECT u.org_id::text
        FROM public.users u
       WHERE u.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "invoice_pdfs_update_own_org" ON storage.objects;
CREATE POLICY "invoice_pdfs_update_own_org"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'invoice-pdfs'
    AND (storage.foldername(name))[1] IN (
      SELECT u.org_id::text
        FROM public.users u
       WHERE u.auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "invoice_pdfs_delete_own_org" ON storage.objects;
CREATE POLICY "invoice_pdfs_delete_own_org"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'invoice-pdfs'
    AND (storage.foldername(name))[1] IN (
      SELECT u.org_id::text
        FROM public.users u
       WHERE u.auth_user_id = auth.uid()
    )
  );

COMMIT;
