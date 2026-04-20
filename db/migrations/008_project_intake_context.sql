-- ============================================================================
-- 008_project_intake_context.sql — Phase 3: parser-first sales dashboard
-- ============================================================================
-- When a project is created via the new PDF parser (or the manual fallback),
-- we stash the raw parse output + the user's role assignments on the project
-- row itself so we can surface them on the project page later and retrain /
-- audit the parser against what the user actually confirmed.
--
-- `intake_context` is loose jsonb intentionally — we're still learning what
-- shape is worth hardening. Canonical keys we write from lib/pdf-parser +
-- the /sales UI:
--
-- {
--   "source": "pdf_parser" | "manual",
--   "file_name": "Henderson-plans-REV2.pdf",
--   "page_count": 4,
--   "parsed_candidates": [
--     { "id": "...", "kind": "email", "value": "...", "role": "email" }, ...
--   ],
--   "role_assignments": {
--     "client_name": "Sarah Henderson",
--     "client_email": "sarah@...",
--     "client_phone": "(415) 555-1212",
--     "designer": "Alvarez Studio",
--     "gc": null,
--     "address": "1842 Vallejo St, San Francisco, CA 94123",
--     "amount": "$84,500",
--     "date": "May 3, 2026"
--   },
--   "parsed_at": "2026-04-19T12:34:56Z"
-- }
-- ============================================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS intake_context jsonb,
  ADD COLUMN IF NOT EXISTS source_pdf_name text,
  ADD COLUMN IF NOT EXISTS client_email text,
  ADD COLUMN IF NOT EXISTS client_phone text,
  ADD COLUMN IF NOT EXISTS designer_name text,
  ADD COLUMN IF NOT EXISTS gc_name text;

-- Quick notes on a project (Phase 3 inline action). Append-only little list
-- so the sales dashboard can capture "left VM", "sent revised quote" etc
-- without dragging a full note entity in.
CREATE TABLE IF NOT EXISTS project_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_notes_project
  ON project_notes(project_id, created_at DESC);
