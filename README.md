# MillSuite MVP — Profit-first cabinet shop OS

Next.js + Supabase MVP for cabinet shop estimating, scheduling, invoicing, and project management.

## Where to start

If you're a fresh agent or human picking this up:

1. **`CLAUDE.md`** — project context, architecture quick-ref, ground rules. Auto-loaded by Claude Code.
2. **`CURRENT-STATE.md`** — what's shipped, what's open, what's next. The most-up-to-date status digest.
3. **`WORKFLOW.md`** — how Andrew + Cowork + Claude Code actually work together. The shipping loop, ground rules, end-of-session ritual.
4. **`SYSTEM-MAP.md`** — architecture and mental model. Stable; describes the system end-to-end.
5. **`BUILD-ORDER.md`** — phased roadmap with checkboxes. Stable; updated when phases close.

## Repo layout

```
app/(marketing)/        Public pages (/, /pricing, /signup, /login)
app/(app)/              Authed app (dashboard, sales, projects, schedule, capacity, invoices, settings, reports, team, rate-book)
app/api/                Server routes
components/             Shared UI
components/composer/    Add-line composer (the heart of estimating)
components/walkthroughs/ Calibration flows (shop rate, base cab, doors, finishes, solid wood top)
lib/                    Pure logic — pricing math, rate book, schedule engine, capacity seed, project hours
db/migrations/          Numbered SQL migrations (001 → ...). Highest-numbered file is the latest schema state.
specs/                  Design specs for big features (composer, walkthroughs)
docs/
  prompts/              Reusable Code prompt templates
  archive/              Historical handoffs, audits, old SQL — quarantined
  dogfood-TEMPLATE.md   Template for end-to-end dogfood reports
mockups/                Original HTML mockups (some referenced by specs)
```

## Key files at the root

- `README.md` — this file. Entry point.
- `CLAUDE.md` — Claude Code context (auto-loaded).
- `CURRENT-STATE.md` — what's shipped/open/next.
- `WORKFLOW.md` — how the team works.
- `SYSTEM-MAP.md` — architecture model.
- `BUILD-ORDER.md` — phased roadmap.

## Getting set up locally

Standard Next.js. `pnpm install`, configure `.env.local` with Supabase + Anthropic keys, `pnpm dev`. The Supabase project is shared (currently single-tenant for development).

## Beta testing

Two early beta testers signed up. Feedback comes in via Andrew; each piece becomes a fresh chat → spec → PR.
