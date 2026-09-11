'use client'

// ============================================================================
// TaskTagChip — one tag, rendered the same everywhere.
// ============================================================================
// Tasks store tag NAMES, and the org's registry supplies the colour. A tag
// whose registry entry was renamed or deleted therefore still renders — in the
// neutral swatch — rather than disappearing. That's the visible half of the
// v1 tradeoff described in migration 098: the name is the data, the registry
// is only decoration, so losing the registry entry must never lose the tag.
// ============================================================================

import { tagSwatch, type TaskTag } from '@/lib/tasks'

export function TaskTagChip({
  name,
  registry,
  onRemove,
  size = 'sm',
}: {
  name: string
  registry: TaskTag[]
  /** When given, the chip grows a ×. */
  onRemove?: () => void
  size?: 'xs' | 'sm'
}) {
  const entry = registry.find((t) => t.name.toLowerCase() === name.toLowerCase())
  const sw = tagSwatch(entry?.color)
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full ${
        size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'
      }`}
      style={{ backgroundColor: sw.bg, color: sw.fg }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: sw.dot }}
        aria-hidden
      />
      {name}
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Remove tag ${name}`}
          className="ml-0.5 opacity-60 hover:opacity-100"
        >
          ×
        </button>
      )}
    </span>
  )
}
