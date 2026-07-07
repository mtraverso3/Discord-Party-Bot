import { useEffect, useRef, useState } from 'react'
import type { ChannelInfo } from '../types'

interface Props {
  channels: ChannelInfo[]
  value: string
  onChange: (id: string) => void
  /** Adds a "— none —" entry that clears the selection. */
  allowNone?: boolean
  placeholder?: string
}

/**
 * Searchable dropdown for picking a channel out of a (potentially huge)
 * client-side list. Behaves like a combobox: typing filters the list,
 * the current selection is shown when closed.
 */
export function ChannelSelect({ channels, value, onChange, allowNone, placeholder }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  const selected = channels.find(c => c.id === value)
  const unknown = value && !selected

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const q = query.trim().toLowerCase()
  const filtered = q ? channels.filter(c => c.name.toLowerCase().includes(q)) : channels

  const pick = (id: string) => {
    onChange(id)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="chsel" ref={boxRef}>
      <button
        type="button"
        className="chsel-trigger"
        onClick={() => { setOpen(o => !o); setQuery('') }}
      >
        {unknown ? `(unknown: ${value})` : selected ? `#${selected.name}` : allowNone ? '— none —' : (placeholder || 'Select a channel')}
      </button>
      {open && (
        <div className="chsel-list">
          <input
            type="text"
            autoFocus
            placeholder={placeholder || 'Search channels…'}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
          />
          <div className="chsel-options">
            {allowNone && (
              <button type="button" className="chsel-item" onClick={() => pick('')}>— none —</button>
            )}
            {filtered.map(c => (
              <button key={c.id} type="button" className="chsel-item" onClick={() => pick(c.id)}>#{c.name}</button>
            ))}
            {filtered.length === 0 && <div className="chsel-empty muted">No channels match</div>}
          </div>
        </div>
      )}
    </div>
  )
}
