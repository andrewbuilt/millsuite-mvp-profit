// ============================================================================
// lib/products.ts — product-tile constants for the add-line composer
// ============================================================================
// Per BUILD-ORDER Phase 12 item 2 + specs/add-line-composer/README.md.
//
// Every estimate line the composer creates belongs to one PRODUCT. The
// product carries the dimensions the pricing math needs — face sheets per
// LF, doors per LF, and the multiplier that scales base-door labor to the
// product's cab height. The user never sees these numbers; they're baked
// in so composer math stays correct without asking for heights on every
// line (heights live on drawings, not the estimate).
//
// Composer math — door labor portion (from README):
//   qty × product.doorsPerLf × product.doorLaborMultiplier
//       × Σ(per-door dept hrs × dept rate)
//
// Composer math — face material portion:
//   qty × product.sheetsPerLfFace × sheet cost   (from the door/drawer
//                                                 material template)
//
// V1 scope: Base, Upper, Full active. Drawer, LED, Countertop declared
// but inactive — their tiles render as stubs in the composer grid.
// Countertop is additionally marked `locked` because it's gated harder
// than "coming later" per the spec ("Later" vs "Stub tile — later").
// User-created products are explicitly out of scope for V1 — the list
// here is the complete product space.
// ============================================================================

export type ProductUnit = 'lf' | 'each'

export type ProductKey =
  | 'base'
  | 'upper'
  | 'full'
  | 'drawer'
  | 'led'
  | 'countertop'

export interface Product {
  key: ProductKey
  /** User-facing tile label. */
  label: string
  /** Short descriptor under the label. */
  descriptor: string
  /** Composer quantity unit. */
  unit: ProductUnit
  /**
   * Face sheets consumed per unit of qty. Derived from typical door size
   * for LF products; irrelevant on stubbed products (set to 0).
   *
   *   Base   24"×30" → 1/12 (0.0833…) sheets per LF
   *   Upper  24"×42" → 1/8  (0.125)   sheets per LF
   *   Full   24"×96" → 1/4  (0.25)    sheets per LF
   *
   * Kept as a number literal rather than a fraction so the composer's live
   * breakdown doesn't have to eval anything at render time.
   */
  sheetsPerLfFace: number
  /**
   * Carcass sheet stock (3/4" ply) consumed per LF. Carcass yield is much
   * higher than face yield because every 30"-tall base eats sides + bottom
   * + shelf + nailers from one or more sheets — face math (which counts
   * door area only) underpriced this badly before the dedicated constant.
   *
   *   Base   0.4   sheets per LF
   *   Upper  0.3   sheets per LF
   *   Full   1.25  sheets per LF
   */
  sheetsPerLfCarcass: number
  /**
   * Back panel sheet stock (1/4" ply) consumed per LF. Same shape numbers
   * as the legacy face-sheet ratio because back panel area scales with
   * cabinet face area.
   *
   *   Base   1/12 (0.0833…) sheets per LF
   *   Upper  1/8  (0.125)   sheets per LF
   *   Full   1/4  (0.25)    sheets per LF
   */
  sheetsPerLfBack: number
  /** Doors per unit of qty. 0.5 across Base/Upper/Full — an 8' run averages
   *  4 doors of mixed widths. */
  doorsPerLf: number
  /**
   * Scales the base-door labor (calibrated at 24"×30" via the door
   * walkthrough) to the product's cab height. Fixed for V1 per the spec —
   * shops don't get to override these until we have real-world pushback.
   *
   *   Base   1.0×    (calibration lives at base)
   *   Upper  1.3×    (larger face, some added handling)
   *   Full   2.5×    (much larger face, more handling + edges)
   */
  doorLaborMultiplier: number
  /** Tile is pickable on the composer grid. */
  active: boolean
  /** Tile is visible but greyed out with a "Later" badge. Implies !active. */
  locked: boolean
}

// Internal helper — all declarations use this so nothing drifts in field
// shape. Not exported; consumers should use PRODUCTS / ACTIVE_PRODUCTS below.
function make(p: Partial<Product> & Pick<Product, 'key' | 'label' | 'unit'>): Product {
  return {
    descriptor: '',
    sheetsPerLfFace: 0,
    sheetsPerLfCarcass: 0,
    sheetsPerLfBack: 0,
    doorsPerLf: 0,
    doorLaborMultiplier: 0,
    active: false,
    locked: false,
    ...p,
  }
}

// ── Active products (V1 composer wires the full slot UI) ──

export const PRODUCT_BASE: Product = make({
  key: 'base',
  label: 'Base cabinet run',
  descriptor: '30" typical',
  unit: 'lf',
  sheetsPerLfFace: 1 / 12,
  sheetsPerLfCarcass: 0.4,
  sheetsPerLfBack: 1 / 12,
  doorsPerLf: 0.5,
  doorLaborMultiplier: 1.0,
  active: true,
})

export const PRODUCT_UPPER: Product = make({
  key: 'upper',
  label: 'Upper cabinet run',
  descriptor: '42" or less',
  unit: 'lf',
  sheetsPerLfFace: 1 / 8,
  sheetsPerLfCarcass: 0.3,
  sheetsPerLfBack: 1 / 8,
  doorsPerLf: 0.5,
  doorLaborMultiplier: 1.3,
  active: true,
})

export const PRODUCT_FULL: Product = make({
  key: 'full',
  label: 'Full height run',
  descriptor: '96" or less',
  unit: 'lf',
  sheetsPerLfFace: 1 / 4,
  sheetsPerLfCarcass: 1.25,
  sheetsPerLfBack: 1 / 4,
  doorsPerLf: 0.5,
  doorLaborMultiplier: 2.5,
  active: true,
})

// ── Inactive products (tiles render as stubs) ──

export const PRODUCT_DRAWER: Product = make({
  key: 'drawer',
  label: 'Drawer',
  descriptor: '—',
  unit: 'each',
  active: false,
})

export const PRODUCT_LED: Product = make({
  key: 'led',
  label: 'LED',
  descriptor: '—',
  unit: 'lf',
  active: false,
})

export const PRODUCT_COUNTERTOP: Product = make({
  key: 'countertop',
  label: 'Countertop',
  descriptor: '—',
  unit: 'lf',
  active: false,
  locked: true,
})

// ── Lookups ──

/**
 * Record keyed by product key. Use for O(1) lookup in line-compute paths.
 */
export const PRODUCTS: Record<ProductKey, Product> = {
  base: PRODUCT_BASE,
  upper: PRODUCT_UPPER,
  full: PRODUCT_FULL,
  drawer: PRODUCT_DRAWER,
  led: PRODUCT_LED,
  countertop: PRODUCT_COUNTERTOP,
}

/**
 * Tile render order for the composer grid. Active products first, then
 * inactive stubs, with countertop (locked) last. Keeps the grid layout
 * stable regardless of which Map iteration order Node picks.
 */
export const PRODUCT_ORDER: ProductKey[] = [
  'base',
  'upper',
  'full',
  'drawer',
  'led',
  'countertop',
]

/** Products that V1 can actually price with. */
export const ACTIVE_PRODUCTS: Product[] = PRODUCT_ORDER
  .map((k) => PRODUCTS[k])
  .filter((p) => p.active)
