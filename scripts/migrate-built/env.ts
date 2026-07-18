// ============================================================================
// scripts/migrate-built/env.ts — credentials + Supabase clients
// ============================================================================
// Two separate Supabase projects (Built OS = source, MillSuite = target).
//
// Resolution order for each var: process.env → scripts/migrate-built/.env →
// (MillSuite only) the repo's .env.local. So MillSuite creds come for free
// from .env.local; Built creds must be supplied via env or the gitignored
// scripts/migrate-built/.env:
//
//   BUILT_SUPABASE_URL=...
//   BUILT_SUPABASE_SERVICE_KEY=...
//   # optional overrides:
//   MILLSUITE_SUPABASE_URL=...        (defaults to .env.local NEXT_PUBLIC_SUPABASE_URL)
//   MILLSUITE_SUPABASE_SERVICE_KEY=.. (defaults to .env.local SUPABASE_SERVICE_ROLE_KEY)
//   TARGET_ORG_SLUG=built
// ============================================================================

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function parseEnvFile(path: string): Record<string, string> {
  try {
    const out: Record<string, string> = {}
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const i = line.indexOf('=')
      if (i === -1) continue
      const key = line.slice(0, i).trim()
      let val = line.slice(i + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      out[key] = val
    }
    return out
  } catch {
    return {}
  }
}

const REPO_ROOT = resolve(__dirname, '..', '..')
const localEnv = parseEnvFile(resolve(REPO_ROOT, '.env.local'))
const migrateEnv = parseEnvFile(resolve(__dirname, '.env'))

function pick(key: string, ...fallbacks: Array<string | undefined>): string | undefined {
  return process.env[key] || migrateEnv[key] || fallbacks.find((v) => !!v)
}

export const BUILT_URL = pick('BUILT_SUPABASE_URL')
export const BUILT_KEY = pick('BUILT_SUPABASE_SERVICE_KEY')
export const MILLSUITE_URL = pick('MILLSUITE_SUPABASE_URL', localEnv['NEXT_PUBLIC_SUPABASE_URL'])
export const MILLSUITE_KEY = pick(
  'MILLSUITE_SUPABASE_SERVICE_KEY',
  localEnv['SUPABASE_SERVICE_ROLE_KEY'],
)
export const TARGET_ORG_SLUG = pick('TARGET_ORG_SLUG') || 'built'

// Seed the vars that app libraries read at import time. lib/supabase.ts does
// `createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ...ANON_KEY!)` at module
// load, and it throws if either is falsy. The estimate verifier (chunk 6a)
// imports lib/estimate-lines + lib/pricing for their *pure* math, which pulls
// that side-effecting module in — so give it non-empty values. The client is
// never used for queries here (the migration uses its own service-role
// clients above), so a placeholder key is fine when .env.local lacks one.
if (!process.env.NEXT_PUBLIC_SUPABASE_URL && MILLSUITE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = MILLSUITE_URL
}
if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
    localEnv['NEXT_PUBLIC_SUPABASE_ANON_KEY'] || MILLSUITE_KEY || 'unused-by-migration'
}

const clientOpts = { auth: { persistSession: false, autoRefreshToken: false } } as const

/** Source (Built OS) client. Throws a clear error if creds are missing. */
export function builtClient(): SupabaseClient {
  if (!BUILT_URL || !BUILT_KEY) {
    throw new Error(
      'Missing Built OS credentials. Set BUILT_SUPABASE_URL + BUILT_SUPABASE_SERVICE_KEY ' +
        '(env vars or scripts/migrate-built/.env).',
    )
  }
  return createClient(BUILT_URL, BUILT_KEY, clientOpts)
}

/** Target (MillSuite) client. Defaults to the repo's .env.local creds. */
export function millsuiteClient(): SupabaseClient {
  if (!MILLSUITE_URL || !MILLSUITE_KEY) {
    throw new Error(
      'Missing MillSuite credentials. Expected NEXT_PUBLIC_SUPABASE_URL + ' +
        'SUPABASE_SERVICE_ROLE_KEY in .env.local, or MILLSUITE_SUPABASE_URL + ' +
        'MILLSUITE_SUPABASE_SERVICE_KEY in the environment.',
    )
  }
  return createClient(MILLSUITE_URL, MILLSUITE_KEY, clientOpts)
}

/** The MillSuite org that receives the data (by slug). */
export async function resolveTargetOrgId(ms: SupabaseClient): Promise<string> {
  const { data, error } = await ms
    .from('orgs')
    .select('id, name, slug')
    .eq('slug', TARGET_ORG_SLUG)
    .single()
  if (error || !data) {
    throw new Error(`Target org not found for slug "${TARGET_ORG_SLUG}": ${error?.message ?? 'no row'}`)
  }
  return data.id as string
}

/** The Built OS service-key REST base — used for the OpenAPI schema fetch. */
export function builtRestBase(): { url: string; key: string } {
  if (!BUILT_URL || !BUILT_KEY) {
    throw new Error('Missing Built OS credentials (BUILT_SUPABASE_URL + BUILT_SUPABASE_SERVICE_KEY).')
  }
  return { url: BUILT_URL.replace(/\/$/, ''), key: BUILT_KEY }
}
