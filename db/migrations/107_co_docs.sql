-- ============================================================================
-- 107 — change orders v2: one open doc per project, drafts until accepted
-- ============================================================================
-- Andrew on v1: "I'm just guessing at the costs." The old modal asked for a
-- dollar figure and some hours with no link to the rate book. His Pajot case
-- is ONE change to the island — remove the rounded end panel, add a finish
-- panel, add a solid-wood waterfall top — which today means three guessed COs.
--
-- v2: a CO is a DRAFT REVISION of the project, priced by the real composer.
-- One OPEN doc per project accumulates changes; everything stays editable
-- until acceptance; acceptance applies the drafts, locks the doc, and opens
-- the next one.
--
-- ⛔⛔ THE ONE ARCHITECTURAL DEPARTURE FROM THE SPEC, AND WHY.
--
-- The spec says a new-scope draft should be "a real subproject flagged as
-- CO-draft", excluded from bid_total, the schedule, capacity, pre-production
-- gating and shop lists until accepted.
--
-- I counted the read sites first: **`from('subprojects')` appears 60 times
-- across 20+ files** — the project page, schedule, capacity, handoff,
-- pre-production, the subproject editor, /time, /time/mobile, the CLIENT
-- PORTAL, the QB push, project-totals, closed-jobs, schedule-seed, the
-- outcome API, the CO PDF route. A flag column makes every one of those an
-- OPT-OUT: each must remember to exclude drafts, forever, including files
-- nobody has opened in months. Miss one and a draft the client has not agreed
-- to leaks into the contract total, the production schedule, the capacity
-- plan, or an invoice.
--
-- This codebase's recurring failure is exactly that shape — the RLS audit's
-- hand-maintained table list, `RESERVED_SLUGS`, the `!inner` join that hid
-- $426k of Leonard work. "Remember to filter in 60 places" is not a design.
--
-- SO: a draft is NOT a subprojects row. It lives as a payload in
-- `co_doc_items.draft`, and a real subproject is MATERIALISED only on
-- acceptance. Drafts then cannot leak, structurally, because they are not
-- rows any of those 60 queries can see. The project page renders them by
-- reading `co_doc_items` explicitly — one deliberate OPT-IN instead of 60
-- chances to forget.
--
-- The user-visible model the spec asked for is unchanged: a new scope still
-- appears as a highlighted draft sub card on the project. Only the storage
-- differs — and the spec's own data sketch already says "draft payload/diff
-- jsonb", so this follows that half of it.
--
-- ⚠️ The cost is that a draft sub can't be opened in the normal subproject
-- editor by id until it's accepted; step 2 (inline composer draft revisions)
-- needs a payload-shaped diff regardless, so this aligns with that work
-- rather than fighting it.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.co_doc_items;
--   DROP TABLE IF EXISTS public.co_docs;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.co_docs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- CO #N as the client sees it. Per project, not global.
  number       integer NOT NULL,
  status       text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'accepted', 'void')),
  title        text NULL,
  -- Stamped on acceptance; `accepted_by` is a LOGIN id (users.id).
  accepted_at  timestamptz NULL,
  accepted_by  uuid NULL,
  -- The client's signature from the portal (092 already has these fields on
  -- change_orders; a v2 doc carries its own).
  signed_name  text NULL,
  signed_at    timestamptz NULL,
  -- Immutable snapshot taken at acceptance.
  pdf_url      text NULL,
  -- One separate QB invoice per accepted doc (Andrew's call).
  qbo_invoice_id text NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ⛔ ONE OPEN DOC PER PROJECT. The whole model is "changes accumulate into the
-- current doc"; two open docs would split a single conversation with the
-- client in half and make "which doc does this edit belong to" unanswerable.
-- Partial, so any number of accepted/void docs can coexist as history.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_co_docs_one_open
  ON public.co_docs(project_id)
  WHERE status = 'open';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_co_docs_number
  ON public.co_docs(project_id, number);

CREATE INDEX IF NOT EXISTS idx_co_docs_project ON public.co_docs(project_id);

CREATE TABLE IF NOT EXISTS public.co_doc_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  -- ⛔ KEYED ON THE DOC, per the spec: an open doc #2 must not tangle with
  -- doc #1's applied history.
  doc_id       uuid NOT NULL REFERENCES public.co_docs(id) ON DELETE CASCADE,
  -- NULL for add_sub (the subproject doesn't exist yet — see the header).
  subproject_id uuid NULL REFERENCES public.subprojects(id) ON DELETE CASCADE,
  kind         text NOT NULL
                 CHECK (kind IN ('add_sub', 'edit_sub', 'remove_sub')),
  -- What the client reads on the PDF.
  description  text NULL,
  -- The draft itself: for add_sub, enough to materialise a subproject and its
  -- lines; for edit_sub, the diff against the contract lines. Shape is owned
  -- by lib/co-docs, deliberately loose here — it follows the composer.
  draft        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- ⛔ STORED, NOT DERIVED AT RENDER (spec). A credit prices at the ORIGINAL
  -- contract value and an addition at CURRENT rates, so re-deriving later —
  -- after the rate book has moved — would silently restate an agreed number.
  -- Negative for a credit.
  delta_amount numeric NOT NULL DEFAULT 0,
  -- How `delta_amount` was arrived at, kept for the audit trail: 'current'
  -- (priced at today's rate book) or 'original' (credited at contract value).
  credit_basis text NULL
                 CHECK (credit_basis IS NULL OR credit_basis IN ('current', 'original')),
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_co_doc_items_doc ON public.co_doc_items(doc_id);

-- ⛔ ONE ITEM PER SUBPROJECT PER DOC. Two edit_sub rows for the same sub in
-- one doc would each hold a different draft of the same thing, and applying
-- them would be order-dependent. add_sub rows have no subproject yet, so they
-- are excluded rather than colliding on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_co_doc_items_sub
  ON public.co_doc_items(doc_id, subproject_id)
  WHERE subproject_id IS NOT NULL;

COMMENT ON TABLE public.co_docs IS
  'Change order v2: one OPEN doc per project accumulating drafts until accepted.';
COMMENT ON COLUMN public.co_doc_items.draft IS
  'The pending change. Drafts are NOT subprojects rows — they materialise on acceptance, so they cannot leak into totals, schedule, capacity, portal or QB.';
COMMENT ON COLUMN public.co_doc_items.delta_amount IS
  'Stored, never re-derived: additions price at current rates, credits at original contract value.';

-- ── RLS ──
ALTER TABLE public.co_docs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS co_docs_own_org ON public.co_docs;
CREATE POLICY co_docs_own_org ON public.co_docs
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

ALTER TABLE public.co_doc_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS co_doc_items_own_org ON public.co_doc_items;
CREATE POLICY co_doc_items_own_org ON public.co_doc_items
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

COMMIT;

NOTIFY pgrst, 'reload schema';
