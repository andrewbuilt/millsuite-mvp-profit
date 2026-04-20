-- ============================================================================
-- 011_item_suggestions_phase10.sql — Phase 10: the learning loop
-- ============================================================================
-- Closed-job detection feeds this table. Every cycle, lib/suggestions.ts
-- re-scans closed jobs and either creates or updates rows here. The
-- /suggestions page pivots on status.
--
-- Suggestion types (matches BUILD-ORDER.md):
--
--   big_up      — item's actual hours are materially higher than its
--                 rate-book estimate across ≥2 closed jobs. Bump the rate
--                 book up.
--   big_down    — mirror image. Book hours high; actuals consistently low.
--   minor       — small but consistent drift (5–15% band). A nudge, not a
--                 reprice.
--   split       — one item is behaving like two distinct jobs-worth-of-hours
--                 distributions. Suggest splitting into two items.
--   quiet       — item is unused for a long stretch. Suggest deprecating.
--
-- Every suggestion carries:
--
--   evidence jsonb — the per-dept actual vs estimated rollup that justified
--                    the suggestion. Contains arrays of per-job entries the
--                    UI renders as toggleable source-job chips.
--
--   source_job_ids uuid[] — the projects that informed it. The UI lets the
--                    user flip individual jobs off before accepting; the
--                    toggled-off set is persisted to `excluded_job_ids` so
--                    accepting re-derives the proposed change without the
--                    excluded evidence.
--
--   proposed_changes jsonb — shape depends on type. big_up/big_down/minor:
--                    { field: '<col>', from: n, to: n } per dept; split:
--                    { new_items: [{ name, labor_hours_* }, ...] }; quiet:
--                    { deprecate: true }.
--
--   dismissed_signature text — hash of the evidence snapshot at dismissal
--                    time. When the suggestion re-engine runs, it only
--                    re-surfaces a dismissed suggestion if the fresh
--                    evidence hash differs. Prevents the same "nudge" from
--                    nagging forever.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS item_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Item under review. Null for `split` suggestions only when we're
  -- proposing two brand-new items out of a non-book cluster (not MVP).
  rate_book_item_id uuid REFERENCES rate_book_items(id) ON DELETE CASCADE,

  suggestion_type text NOT NULL
    CHECK (suggestion_type IN ('big_up', 'big_down', 'minor', 'split', 'quiet')),

  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'accepted', 'dismissed')),

  -- Evidence + source jobs.
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_job_ids uuid[] NOT NULL DEFAULT '{}',
  excluded_job_ids uuid[] NOT NULL DEFAULT '{}',

  -- The concrete change the user accepts. Opaque to the DB; lib/suggestions.ts
  -- owns the shape.
  proposed_changes jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Short human-readable reason shown in the row card.
  rationale text,

  -- Signature of the evidence snapshot at dismissal. If re-generation
  -- produces a different signature, a new `active` row surfaces.
  dismissed_signature text,
  dismissed_at timestamptz,
  dismissed_by uuid,

  -- Stamped when user accepts; points at the rate_book_item_history row
  -- that captured the change.
  accepted_at timestamptz,
  accepted_by uuid,
  accepted_history_id uuid REFERENCES rate_book_item_history(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_item_suggestions_org
  ON item_suggestions(org_id);
CREATE INDEX IF NOT EXISTS idx_item_suggestions_status
  ON item_suggestions(org_id, status);
CREATE INDEX IF NOT EXISTS idx_item_suggestions_item
  ON item_suggestions(rate_book_item_id) WHERE rate_book_item_id IS NOT NULL;

-- Only ONE active suggestion per (item, type) at a time. The re-scan either
-- updates the existing row or leaves it alone. Dismissed/accepted rows don't
-- collide with the active one thanks to the partial index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_item_suggestions_active
  ON item_suggestions(org_id, rate_book_item_id, suggestion_type)
  WHERE status = 'active' AND rate_book_item_id IS NOT NULL;

COMMENT ON TABLE item_suggestions IS
  'Phase 10 learning loop. One row per active/dismissed/accepted suggestion. Regenerated from closed-job evidence.';

COMMENT ON COLUMN item_suggestions.dismissed_signature IS
  'Hash of evidence at dismissal. Re-engine compares fresh evidence hash; only re-surfaces when it differs.';

COMMIT;
