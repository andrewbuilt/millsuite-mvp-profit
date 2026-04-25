-- ============================================================================
-- 012_onboarding_phase11.sql — Phase 11: onboarding wizard state
-- ============================================================================
-- ⚠️ SUPERSEDED 2026-04-24 — Phase 11 was retired. The four-step parsing
-- wizard described below was never completed (OCR / past-estimate parse /
-- bank-statement burden were scoped but not built); the dept-rate slider
-- flow was replaced by the first-principles blended-rate walkthrough
-- (Phase 12 Item 12) before shipping in a user-facing form. See
-- BUILD-ORDER.md Phase 11 (collapsed) + Phase 12 Items 5/12.
--
-- These tables (onboarding_progress, onboarding_stashed_baselines) are
-- dead code in the active app. A follow-up migration will drop them
-- once the orphan helpers in lib/onboarding.ts are deleted. Until then,
-- this migration stays applied for historical integrity — do not extend
-- these tables; build first-run state on `users.onboarded_at` +
-- `users.onboarding_step` instead (see migrations 020 and later).
--
-- Historical intent (retained for archive):
--
--   1. Business card parse          → prefill contact + company.
--   2. Past estimate upload         → baselines into rate_book_items,
--                                     gray confidence until used.
--   3. Redacted bank statement      → shop burden / effective rate suggestion.
--   4. Dept-rate interview          → sliders with real-world references.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS onboarding_progress (
  org_id uuid PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  -- Shape: { card: 'done'|'skipped'|'pending', estimate: ..., bank: ..., rates: ... }
  step_states jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Optional scratch payload per step (business-card OCR, bank burden calc,
  -- etc.). Drop when the wizard finishes.
  step_payloads jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  dismissed_at timestamptz
);

COMMENT ON TABLE onboarding_progress IS
  'One row per org tracking onboarding wizard step states. Dismissed = user closed the wizard for good; completed = every step done or skipped.';

-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS onboarding_stashed_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  source text NOT NULL
    CHECK (source IN ('estimate_upload', 'bank_statement', 'manual')),
  -- The baseline kind drives how the /onboarding UI renders it and what
  -- shape proposed_changes takes when the user accepts.
  kind text NOT NULL
    CHECK (kind IN ('rate_book_item_baseline', 'shop_rate_baseline',
                    'dept_rate_baseline', 'material_cost_baseline')),
  -- Pointer back to the concrete rate_book_items row when kind = baseline.
  -- Null means the wizard couldn't reconcile and will ask the user to pick.
  rate_book_item_id uuid REFERENCES rate_book_items(id) ON DELETE SET NULL,
  -- Parsed payload — the candidate numbers the wizard wants to seed.
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Confidence heuristic for the parse itself (separate from item confidence).
  parse_confidence numeric,
  notes text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'dismissed')),
  accepted_at timestamptz,
  dismissed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_onboarding_stash_org
  ON onboarding_stashed_baselines(org_id, status);
CREATE INDEX IF NOT EXISTS idx_onboarding_stash_item
  ON onboarding_stashed_baselines(rate_book_item_id)
  WHERE rate_book_item_id IS NOT NULL;

COMMENT ON TABLE onboarding_stashed_baselines IS
  'Parsed numbers from the onboarding wizard that the user can accept into the rate book (or dismiss). One row per candidate.';

-- ---------------------------------------------------------------------------
-- Confidence-ramp support: rate_book_items already has `confidence` +
-- `confidence_job_count` + `confidence_last_used_at`. The Phase 11 ramp
-- bumps these when a job referencing the item closes (Phase 10's closed-job
-- scan writes the bump). No schema change needed here — just documenting
-- the read pattern.
-- ---------------------------------------------------------------------------

COMMIT;
