// ============================================================================
// verify-supplies.mjs — the supplies search, and the URL safety boundary.
// ============================================================================
// Run: npx tsx scripts/verify-supplies.mjs
// (tsx, not node — it imports .ts. No credentials: the logic under test is pure.)
//
// Two things worth pinning:
//   1. The search is the ONLY way to narrow the list (no categories in v1), so
//      if it matched names alone the page would feel broken.
//   2. `url` is rendered as an href, which makes it an XSS surface. It goes
//      through the allowlist in lib/task-links both on write AND on read —
//      this checks the read path, because a row can reach the database
//      without passing through the app.
// ============================================================================

// ⛔ lib/supply-item, NOT lib/supplies — the latter imports lib/supabase,
// which builds a client at module scope and throws here without credentials.
// That is exactly how verify-payments ended up unable to run as documented.
import { supplyMatches } from '../lib/supply-item.ts'
import { normalizeLinkUrl } from '../lib/task-links.ts'

let pass = 0
let fail = 0

function check(name, got, want) {
  if (got === want) pass++
  else {
    fail++
    console.log(`  ❌ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
  }
}

const item = (over = {}) => ({
  id: 'x',
  name: 'PSA sandpaper rolls, 120 grit',
  url: 'https://klingspor.com/psa',
  vendor: 'Klingspor',
  vendorInfo: '(800) 555-0199 · ask for Dave · acct 44812',
  notes: 'Min order 4 rolls. Takes about a week.',
  active: true,
  createdAt: '',
  ...over,
})

// ── Search covers EVERY field ──────────────────────────────────────────────
{
  const it = item()
  check('empty query matches everything', supplyMatches(it, ''), true)
  check('whitespace query matches everything', supplyMatches(it, '   '), true)
  check('by name', supplyMatches(it, 'sandpaper'), true)
  check('by vendor', supplyMatches(it, 'klingspor'), true)
  check('case-insensitive', supplyMatches(it, 'KLINGSPOR'), true)
  check('by phone number', supplyMatches(it, '555-0199'), true)
  check('by account number', supplyMatches(it, '44812'), true)
  check("by the rep's name", supplyMatches(it, 'dave'), true)
  check('by a word in the notes', supplyMatches(it, 'min order'), true)
  check('by url', supplyMatches(it, 'klingspor.com'), true)
  check('no match', supplyMatches(it, 'plywood'), false)
}

// ── ⛔ Terms AND across fields ─────────────────────────────────────────────
// "klingspor sandpaper" has to find the row whose VENDOR is one word and
// whose NAME is the other. Matching per-field would miss it; OR-ing the terms
// would widen the list as you type instead of narrowing it.
{
  const it = item()
  check('terms may span fields', supplyMatches(it, 'klingspor sandpaper'), true)
  check('one bad term kills the match', supplyMatches(it, 'klingspor plywood'), false)

  const other = item({ name: 'Drawer slides', vendor: 'Blum', vendorInfo: null, notes: null })
  check('the other row does not match', supplyMatches(other, 'klingspor sandpaper'), false)
  check('but matches its own', supplyMatches(other, 'blum slides'), true)
}

// ── Null fields don't throw ────────────────────────────────────────────────
{
  const bare = item({ url: null, vendor: null, vendorInfo: null, notes: null })
  check('name-only row still searchable', supplyMatches(bare, 'sandpaper'), true)
  check('name-only row misses vendor terms', supplyMatches(bare, 'klingspor'), false)
}

// ── ⛔ The href boundary ───────────────────────────────────────────────────
// lib/supplies normalises on the way OUT of the database as well as in, so a
// row written directly to Postgres can't reach an anchor unchecked.
{
  check('javascript: is refused', normalizeLinkUrl('javascript:alert(1)'), null)
  check('data: is refused', normalizeLinkUrl('data:text/html,<script>x</script>'), null)
  check('vbscript: is refused', normalizeLinkUrl('vbscript:msgbox(1)'), null)
  check('file: is refused', normalizeLinkUrl('file:///etc/passwd'), null)
  // Trailing slash is the URL parser's own normalisation of a bare host, not
  // something this code adds. Asserted as-is rather than "fixed".
  check('a bare domain becomes https', normalizeLinkUrl('klingspor.com'), 'https://klingspor.com/')
  check('https survives', normalizeLinkUrl('https://klingspor.com/psa'), 'https://klingspor.com/psa')
  check('prose is not a url', normalizeLinkUrl('ask Dave at the counter'), null)
  check('empty is null', normalizeLinkUrl(''), null)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
