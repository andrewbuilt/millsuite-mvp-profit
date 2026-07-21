-- ============================================================================
-- 068 — project_documents (CO step 7: Documents section on the project page)
-- ============================================================================
-- Arbitrary reference links attached to a project — a Drive folder, a signed
-- contract PDF, shop drawings, anything with a URL. The Documents section also
-- surfaces auto-derived docs (estimate PDF, contract invoice, CO invoices) but
-- those are computed from existing tables; this table holds only the manual
-- "+ document link" entries the operator adds.
--
-- Project-scoped RLS via EXISTS on projects (matches 031 precedent). Idempotent
-- (IF NOT EXISTS). Run against prod Supabase before deploying the code.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.project_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  label       text NOT NULL,
  url         text NOT NULL,
  kind        text NOT NULL DEFAULT 'link',   -- 'link' | 'drive' | 'file' | …
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_documents_project
  ON public.project_documents(project_id, created_at);

ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_documents_select_authenticated ON public.project_documents;
DROP POLICY IF EXISTS project_documents_insert_authenticated ON public.project_documents;
DROP POLICY IF EXISTS project_documents_delete_authenticated ON public.project_documents;

CREATE POLICY project_documents_select_authenticated
  ON public.project_documents FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_documents.project_id)
  );

CREATE POLICY project_documents_insert_authenticated
  ON public.project_documents FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_documents.project_id)
  );

CREATE POLICY project_documents_delete_authenticated
  ON public.project_documents FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_documents.project_id)
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
