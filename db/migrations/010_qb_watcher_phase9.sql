-- ============================================================================
-- 010_qb_watcher_phase9.sql — Phase 9: QB watcher + milestone status
-- ============================================================================
-- MillSuite never *sends* to QuickBooks. It only watches.
--
-- Two tables land here:
--
--   qb_connections — per-org OAuth state. Stores the Intuit realm_id plus
--     opaque access/refresh tokens. We don't enforce an `active` column yet;
--     a disconnected org simply has its row deleted. Tokens are stored
--     base64-encoded (not encrypted) — same posture as every other soft
--     secret in MillSuite's MVP schema; we'll rotate to Vault when we ship
--     the multi-tenant plane.
--
--   qb_events — audit log of every event we observed, whether matched or
--     not. One row per Intuit webhook (or polling hit). Carries the raw
--     payload for future debugging, plus denormalized matching fields so
--     the reconciliation UI doesn't have to re-parse JSON on every paint.
--     Match state is tracked as 'unmatched' | 'matched' | 'confirmed' |
--     'dismissed'. The reconciliation page pivots on this.
--
-- Phase 9 also needs to flip milestones → 'received'. That path is already
-- supported by `cash_flow_receivables.status` (CHECK constraint already
-- includes 'received'), so no schema change there — the write happens from
-- lib/qb-events.ts when a match is confirmed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS qb_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE,
  realm_id TEXT NOT NULL,            -- Intuit company (realm) id
  access_token TEXT,                 -- base64 of the raw OAuth access token
  refresh_token TEXT,                -- base64 of the raw OAuth refresh token
  expires_at TIMESTAMPTZ,            -- when the access token expires
  connected_at TIMESTAMPTZ DEFAULT now(),
  last_polled_at TIMESTAMPTZ,        -- most recent polling cycle (if used)
  scope TEXT,                         -- scopes granted on this connection
  metadata JSONB DEFAULT '{}'::jsonb  -- arbitrary company-level metadata
);

CREATE INDEX IF NOT EXISTS idx_qb_connections_org ON qb_connections(org_id);

COMMENT ON TABLE qb_connections IS
  'One row per org with an active QuickBooks connection. Deleting the row disconnects the org.';

-- ============================================================================

CREATE TABLE IF NOT EXISTS qb_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),

  -- ── Source / identity of the observed event ──
  source TEXT NOT NULL DEFAULT 'webhook'
    CHECK (source IN ('webhook', 'poll', 'manual')),
  event_type TEXT NOT NULL           -- e.g. 'payment_received', 'invoice_paid'
    CHECK (event_type IN ('payment_received', 'invoice_paid', 'deposit_received', 'other')),
  qb_event_id TEXT,                  -- Intuit's event id when available, for dedup
  qb_object_id TEXT,                 -- Payment / Invoice id inside QB
  occurred_at TIMESTAMPTZ NOT NULL,  -- when the payment cleared in QB

  -- ── Denormalized match inputs ──
  customer_name TEXT,
  amount NUMERIC NOT NULL,
  currency TEXT DEFAULT 'USD',
  memo TEXT,

  -- ── Match outcome ──
  match_status TEXT NOT NULL DEFAULT 'unmatched'
    CHECK (match_status IN ('unmatched', 'matched', 'confirmed', 'dismissed')),
  matched_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  matched_receivable_id UUID REFERENCES cash_flow_receivables(id) ON DELETE SET NULL,
  match_confidence NUMERIC,          -- 0–1, computed by lib/qb-events.ts
  match_reasons JSONB DEFAULT '[]'::jsonb,  -- array of strings explaining the score

  -- ── Full raw Intuit payload for forensics ──
  payload JSONB DEFAULT '{}'::jsonb,

  -- ── Reviewer state ──
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID                    -- soft-FK to auth user id
);

CREATE INDEX IF NOT EXISTS idx_qb_events_org ON qb_events(org_id);
CREATE INDEX IF NOT EXISTS idx_qb_events_status
  ON qb_events(org_id, match_status);
CREATE INDEX IF NOT EXISTS idx_qb_events_project
  ON qb_events(matched_project_id) WHERE matched_project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qb_events_receivable
  ON qb_events(matched_receivable_id) WHERE matched_receivable_id IS NOT NULL;

-- Dedup on (org_id, qb_event_id) when Intuit sends us an id; partial index
-- skips rows where we don't have one (manual sim events, or earlier Intuit
-- APIs that omit the id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_qb_events_dedup
  ON qb_events(org_id, qb_event_id) WHERE qb_event_id IS NOT NULL;

COMMENT ON TABLE qb_events IS
  'Audit log of every QuickBooks event MillSuite has observed. One row per webhook/poll hit. Reconciliation UI pivots on match_status.';

COMMENT ON COLUMN qb_events.match_confidence IS
  '0.0–1.0 score from lib/qb-events.ts — combines customer-name similarity, amount proximity to a projected milestone, and time window.';

COMMENT ON COLUMN qb_events.match_reasons IS
  'Array of short human-readable reasons ("Exact amount match for 50% deposit", "Customer name matched on +/- 1 edit", etc.) surfaced in reconciliation UI.';
