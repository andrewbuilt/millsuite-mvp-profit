# MillSuite Code Audit — 2026-05-31

Read-only pass focused on the highest-risk surfaces: the Stripe money path (PRs #112–118), pricing/margin math (flagged as "not calculating right"), API-route auth/gating, and general health. Every finding below cites `file:line` and was verified against the current code on `main` (HEAD `861752a`, migration 051).

Nothing here was changed. Each item is sized as a standalone PR so it fits the one-PR-at-a-time rule.

**Headline:** the money path is well-built and the *live* margin math is internally consistent — but there are two genuine security holes (unauthenticated AI routes), and your margin confusion is real: it comes from the word "margin" meaning two different formulas in two different features, plus mislabeled UI copy.

---

## HIGH — fix first

### H1. `/api/schedule-ai` and `/api/parse-invoice` are open, unauthenticated Claude proxies
**Where:** `app/api/schedule-ai/route.ts:1-56`, `app/api/parse-invoice/route.ts:1-78`
**What:** Both routes accept a POST and forward it straight to `api.anthropic.com` using your `ANTHROPIC_API_KEY`, with **no session check, no org check, no rate limit**. `schedule-ai` is the worst case — it passes a caller-supplied `system` prompt and `messages` array through verbatim with `max_tokens: 8192`. Anyone who knows the URL can send unlimited arbitrary prompts to Claude billed to you.
**Why it matters:** Direct, automatable drain on your Anthropic spend, and a way to use your key for anything. `parse-drawings` already does auth (9 checks) — these two were missed.
**Fix:** Require an authenticated Supabase session, resolve the user's `org_id`, and gate on `plan_status === 'active'` (and for `schedule-ai`, on the `ai-estimating` / Pro+ feature). Add a per-org rate limit. Stop passing a raw client `system` prompt — build it server-side.
**PR size:** Small, but ship it ASAP.

---

## MEDIUM

### M1. The margin "bug" is a terminology collision, not a math error
**Where:** `lib/pricing.ts:95` vs `lib/project-totals.ts:138-141` and `app/(app)/projects/[id]/page.tsx:632-634`
**What:** The same "profit %" knob means two different formulas:
- **Project pricing** (the live, customer-facing path) treats it as a **true gross margin**: `markup = 1 / (1 − margin/100)`. A 35% entry on a $10,000 cost → **$15,385** price, which actually *is* a 35% margin.
- **Shop-rate calc** (`computeShopRate`) treats "profit %" as a **markup on cost**: `shopRate = costPerHour × (1 + profit/100)`. A 35% entry → cost × 1.35, which is only a **25.9% margin**.

So entering "35%" in two places that both say "profit" produces two different effective margins. That is almost certainly why the number "feels off."
**Compounding it:** the project page's own helper text (`page.tsx:1671-1672`) calls the value *"the markup at the project level"* — but the field is `target_margin_pct`, Settings labels it *"Default profit margin"* (`settings/page.tsx:791`), and the math is true-margin. The UI calls one number three different things.
**Fix (decide intent first):** Pick one definition of "profit %" for the whole app. Recommended: keep project pricing as true margin (it's the correct, more conservative one), then (a) fix the `page.tsx` helper copy from "markup" to "margin," and (b) decide whether `computeShopRate` should also be margin-based or stay a markup with a clearer label. This is a "read-only explainer + small copy/logic PR," not a rewrite.
**PR size:** Small (copy + one formula decision). Worth a 10-min spec conversation before coding.

### M2. Dead `computeSubprojectPrice` uses the *wrong* formula and is labeled "single source of truth"
**Where:** `lib/pricing.ts:23-49` (header comment line 2)
**What:** `computeSubprojectPrice` computes `price = cost × (1 + profitMarginPct/100)` — the markup-as-margin formula from M1. It has **zero callers** (the live path uses `computeSubprojectRollup` + the project-level true-margin markup). So it's not hurting anyone today — but it's a loaded gun: the file calls itself "single source of truth," so the next person who needs subproject pricing will reach for it and silently reintroduce the M1 discrepancy.
**Fix:** Either delete it, or correct the formula to match `project-totals.ts` and drop the "single source of truth" claim.
**PR size:** Trivial.

### M3. Consumable-markup default disagrees: UI shows 15%, pricing uses 10%
**Where:** `app/(app)/settings/page.tsx:91,163` (`useState('15')`) vs 8 sites using `?? 10` (e.g. `project-totals.ts:91`, `projects/[id]/page.tsx:250,351`)
**What:** A brand-new org that never saved Settings is priced with a **10%** consumable markup, but the Settings screen *displays* **15%** as the current value. If the owner opens Settings and clicks Save without touching it, they write 15 — silently bumping every estimate. Pre-save vs post-save prices differ for no visible reason.
**Fix:** Pick one default (10 or 15) and use it everywhere — ideally seed it explicitly into `orgs.consumable_markup_pct` on signup so there's no implicit fallback at all.
**PR size:** Trivial.

### M4. `/api/auth/setup` has no transaction — failures orphan orgs and retries duplicate them
**Where:** `app/api/auth/setup/route.ts:67-128`
**What:** The route inserts the org, then the user, then patches `owner_id`, then seeds settings/departments — with no transaction. If the **user** insert fails (line 125), the org row already exists and is orphaned. Worse, the early-return dedupe check (line 36-49) only looks at the `users` table, so a retry after a partial failure creates a **second** org rather than recovering the first. This is the same class of bug that produced the duplicate-customer mess #116 fixed on the Stripe side.
**Fix:** Wrap the create sequence in a Postgres function / RPC transaction, or check for an existing pending org by owner before inserting. At minimum, clean up the org if the user insert fails.
**PR size:** Medium.

### M5. Unauthenticated state/compute routes (IDOR)
**Where:** `app/api/projects/[id]/advance-phase/route.ts`, `app/api/projects/[id]/rollup/route.ts` (both 0 auth checks)
**What:** Both take `projectId` from the URL and act on it (advance stage / recompute totals) with no session or tenant check. Anyone with a project UUID can poke another org's project. Impact is limited (UUIDs aren't guessable; `advance-phase` only succeeds if approvals are met; `rollup` is an idempotent recompute) — but there's no reason these should be open.
**Fix:** Add the same session→org resolution the other routes use and verify the project belongs to the caller's org.
**PR size:** Small.

---

## LOW / DEBT

### L1. Webhook seat-downgrade guard creates a bill-vs-access mismatch
**Where:** `app/api/stripe-webhook/route.ts:259-285`
**What:** When a customer reduces seats in the Customer Portal below their current user count, the handler (correctly) refuses to drop `orgs.seats` — but Stripe has *already* lowered the billed quantity. Result: the org keeps all users active while paying for fewer seats. The comment frames this as temporary, but nothing forces resolution, so it can persist as a quiet revenue leak.
**Fix:** Either surface a "remove N users to finish your downgrade" banner gated on `users.count > seats`, or reject the change in the Portal via Stripe's quantity limits.
**PR size:** Small–medium.

### L2. Webhook has no event idempotency
**Where:** `app/api/stripe-webhook/route.ts:52-82`
**What:** Stripe delivers at-least-once. The DB updates are naturally idempotent (they set fixed values), but `handleCheckoutCompleted` fires `trackActivation` to Klaviyo (line 177) on every delivery — a redelivered `checkout.session.completed` re-fires the activation event and can double-trigger the welcome flow.
**Fix:** Record processed `event.id`s (a `stripe_events` table) and short-circuit duplicates at the top of the handler.
**PR size:** Small.

### L3. Latent Stripe API-version landmine
**Where:** `lib/stripe.ts:24` (pinned `2024-12-18.acacia`) + `stripe-webhook/route.ts:117,234` (`subscription.current_period_end`), `:195` (`invoice.subscription`)
**What:** `current_period_end` (top-level on Subscription) and `invoice.subscription` only exist in the acacia-era API. In the 2025 "basil" versions they moved (to subscription *items* / line periods). The webhook is correct **today** because the version is pinned — but a routine `apiVersion` bump would turn `subscription.current_period_end` into `undefined`, and `new Date(undefined*1000).toISOString()` throws `RangeError`, 500-ing the webhook and silently failing activations.
**Fix:** Add a comment at the pin warning that a version bump requires updating these reads, or defensively read from `subscription.items.data[0].current_period_end` with a fallback.
**PR size:** Trivial (comment) or small (defensive read).

### L4. `/api/auth/setup` trusts `auth_user_id` from the request body
**Where:** `app/api/auth/setup/route.ts:14-15`
**What:** The route accepts `auth_user_id` from the JSON body rather than deriving it from the verified session token. Low risk (you'd need a victim's auth UUID, and it only helps if they have no org yet) but it's the kind of trust-the-client pattern worth closing.
**Fix:** Read the user from the Supabase session/JWT server-side instead of the body.
**PR size:** Small.

### L5. Margin math is duplicated in two places
**Where:** `lib/project-totals.ts:138-141` and `app/(app)/projects/[id]/page.tsx:632-634`
**What:** The true-margin markup is hand-copied in both spots (the code comments even admit it: "deliberately a duplicate… if you change one, change both"). They agree *today*. The moment they drift you get list-view prices that disagree with the project page.
**Fix:** Lift the `costTotal → priceTotal` markup into one shared pure helper in `lib/pricing.ts` (the correctly-formulated one) and call it from both.
**PR size:** Small.

### L6. Housekeeping
- **234 `as any` / `: any`** across `lib`/`app`/`components`. Zero `@ts-ignore` (good). Worth chipping away at the `any`s in the pricing and Stripe modules specifically, where a wrong shape costs money.
- **`tsconfig.json:3`** pins `target: ES5`, which is deprecated and stops working in TypeScript 7.0. Bump to a modern target (ES2020+) and add `tsc --noEmit` to a pre-merge check — a full typecheck did not complete in the audit's time budget, so confirm it passes clean.
- **`docs/seed-demo.sql` / `seed-demo-enhanced.sql`** remain flagged as unverified against current schema (carried over from the old state doc) — audit or delete before relying on them.

---

## What's healthy (don't touch)
- The Stripe **checkout** flow's idempotency (reuse open session, customer-reuse-by-email) is well done and directly addresses the duplicate-customer incident.
- Migrations **050/051** follow the house rules: `ADD COLUMN IF NOT EXISTS` + `NOTIFY pgrst`.
- The CLAUDE.md pitfall about legacy `subprojects.labor_hours` is respected — all `*labor_hours*` reads are rate-book `base_labor_hours_*` columns, not the banned field.
- The **live** pricing path (project page + `project-totals.ts`) is internally consistent; the confusion is naming/UX (M1), not a wrong number in production.

## Suggested order
1. **H1** (security/cost — today).
2. **M5** (IDOR, same auth pattern as H1 — bundle the thinking).
3. **M1 + M2** (margin clarity — one spec convo, then a small copy/logic PR; this is the thing that's been bugging you).
4. **M3, M4** (data-consistency footguns).
5. **L1–L6** as backburner / opportunistic.
