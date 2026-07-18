# Built OS → MillSuite migration

Export/import scripts for moving Built OS's live project data into MillSuite
(separate Supabase projects, so this is a script, not in-database SQL).
Reference plan: `../../../built-os/docs/DATA-MIGRATION-INVENTORY.md` and the
"Built OS → MillSuite data migration" spec in `STATE.md`.

## Credentials

MillSuite creds load automatically from the repo's `.env.local`
(`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`). Built OS creds you
must supply — put them in a **gitignored** `scripts/migrate-built/.env`:

```
BUILT_SUPABASE_URL=https://xxxx.supabase.co
BUILT_SUPABASE_SERVICE_KEY=eyJ...            # Built OS service-role key
# optional overrides:
# MILLSUITE_SUPABASE_URL=...
# MILLSUITE_SUPABASE_SERVICE_KEY=...
TARGET_ORG_SLUG=built                        # MillSuite org that receives the data
```

or pass them inline: `BUILT_SUPABASE_URL=… BUILT_SUPABASE_SERVICE_KEY=… npx tsx …`

> The service keys bypass RLS. This targets the **live** MillSuite org, so use
> `--dry-run` / `--project` first (see below). `.env` here is gitignored.

## Prerequisite migration

Run **`db/migrations/063_migration_id_map.sql`** on the MillSuite Supabase
project before the write phase — it creates `migration_id_map` (idempotency)
and `projects.built_archive` (snapshot store). The scripts refuse to run
their write phase without it.

## Scripts

**1. Schema snapshot (chunk 1)** — dump the live Built OS schema (columns,
types, row counts, estimate-format split) to `schema-snapshot/`. Schema only,
no row data:

```
npx tsx scripts/migrate-built/dump-schema.ts
```

**2. Migration (chunk 2 scaffold; entities land in chunks 3–5):**

```
npx tsx scripts/migrate-built/migrate.ts --dry-run
npx tsx scripts/migrate-built/migrate.ts --project <built-project-id>   # single-project test
npx tsx scripts/migrate-built/migrate.ts --entity project --limit 5
npx tsx scripts/migrate-built/migrate.ts                                # full run
```

### Flags

| Flag | Effect |
|---|---|
| `--dry-run` | Print the plan; write nothing. |
| `--entity <name>` | One entity: `client` \| `project` \| `subproject` \| `estimate_line` \| `milestone`. |
| `--project <built-id>` | Migrate one Built project + its children (the test-pass path). |
| `--limit <N>` | Cap rows per entity. |

## Idempotency

Every migrated row is recorded in `migration_id_map` keyed on
`(org_id, entity, built_id)`. A re-run updates the mapped MillSuite row
instead of duplicating. See `id-map.ts`.

## Order

`client → project → subproject → estimate_line → milestone` (parents before
children so FKs resolve through the map). Built `leads` **and** `projects`
both land in MillSuite `projects` (stage field). Out of this pass: time
entries, schedule state, vendors/materials/rate-book, QB relink, selections.
