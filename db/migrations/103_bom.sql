-- ============================================================================
-- 103 — bom_items  (the purchasing list parsed off approved drawings)
-- ============================================================================
-- Andrew, 2026-09-12, three calls: it lives ON THE PROJECT · COUNTS ONLY ·
-- editable and saved.
--
-- ⛔ THIS IS A PURCHASING LIST, NOT A CUT LIST. No part dimensions, no
-- nesting, no grain direction, no optimisation. "How many sheets of 3/4 white
-- oak do I buy" — not "how do I cut them". A cut list is a different product
-- and was explicitly scoped out; a `length`/`width` column here is the first
-- step into building one by accident.
--
-- ⛔ AND IT DOES NOT PRICE ANYTHING. No cost, no vendor id, no markup. The
-- rate book prices jobs; this tells the shop what to order. Same boundary as
-- supply_items (102), for the same reason: two tables describing the same
-- material will disagree.
--
-- ── THE TWO QUANTITY COLUMNS, WHICH ARE THE POINT OF THIS TABLE ─────────────
--
--   qty        the WORKING number. A human owns it. Nothing automatic may
--              ever write it after the row is created.
--   parsed_qty what the PARSER last said. Only the parser writes it.
--
-- Andrew's rule: "re-parse appends new finds and flags count differences — it
-- never overwrites or deletes edited rows." One column can't do that. With
-- one, a re-parse either clobbers the correction someone made by hand, or it
-- has nowhere to report that the drawings now say 14 where the shop wrote 12.
-- Two columns make the disagreement visible and leave the human's number
-- alone. The UI shows "parser now says 14" beside it; a person decides.
--
-- This is the merge-allowlist lesson from the task system, in schema form: an
-- automatic write that silently reverts a human edit is the worst kind of
-- bug, because the save appears to succeed.
--
-- `checked_off` is the purchasing workflow AND the trust boundary: parsed
-- counts are estimates until a person has looked. See the UI copy.
--
-- Idempotent. RLS follows the `projects`/`tasks` FOR-ALL org pattern.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.bom_items;
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.bom_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  -- CASCADE: a deleted project's shopping list describes nothing.
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  category     text NOT NULL DEFAULT 'other'
                 CHECK (category IN ('sheet_good', 'hardware', 'drawer', 'other')),
  name         text NOT NULL,
  -- Thickness / material / size, as the drawings state it. Freeform because
  -- drawings are: "3/4 white oak veneer core", "21in full-extension soft close".
  spec         text NULL,

  -- ⛔ THE HUMAN'S NUMBER. Never written by a re-parse. See the header.
  qty          numeric NOT NULL DEFAULT 0 CHECK (qty >= 0),
  -- ⛔ THE PARSER'S NUMBER. Only ever written by a parse. NULL on a row a
  -- person added by hand — there is no parser opinion about it.
  parsed_qty   numeric NULL,

  unit         text NOT NULL DEFAULT 'ea',
  source       text NOT NULL DEFAULT 'manual'
                 CHECK (source IN ('parsed', 'manual')),
  -- The purchasing pass. Also the trust boundary: a parsed row is an estimate
  -- until someone ticks this.
  checked_off  boolean NOT NULL DEFAULT false,
  notes        text NULL,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bom_items_project
  ON public.bom_items(project_id);

-- ⛔ THE DEDUPE GUARANTEE LIVES HERE, NOT ONLY IN TYPESCRIPT. `bomKey` in
-- lib/bom-merge matches an incoming parsed item against rows the CLIENT
-- happens to be holding. That's fine until the client's copy is stale — a
-- parse takes up to five minutes, during which someone can add a row in
-- another tab, and then a re-parse inserts it a second time. Matching the
-- key's normalisation (lower + collapsed whitespace) makes the duplicate
-- impossible rather than unlikely.
--
-- ⚠️ Matches `bomKey` DELIBERATELY: category + name + spec, case-insensitive.
-- If that function's normalisation changes, this index has to change with it
-- or the two disagree — the app would think a row is new and the database
-- would refuse it.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bom_items_identity
  ON public.bom_items (
    project_id,
    category,
    lower(regexp_replace(btrim(name), '\s+', ' ', 'g')),
    lower(regexp_replace(btrim(coalesce(spec, '')), '\s+', ' ', 'g'))
  );

COMMENT ON TABLE public.bom_items IS
  'Purchasing list for a project, drafted from approved drawings. NOT a cut list and it prices nothing.';
COMMENT ON COLUMN public.bom_items.qty IS
  'The working count. A HUMAN owns this — no automatic process may overwrite it.';
COMMENT ON COLUMN public.bom_items.parsed_qty IS
  'What the parser last reported. Only a parse writes it. A difference from qty is shown, never applied.';

-- ── RLS ──
ALTER TABLE public.bom_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bom_items_own_org ON public.bom_items;
CREATE POLICY bom_items_own_org ON public.bom_items
  FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());

COMMIT;

NOTIFY pgrst, 'reload schema';
