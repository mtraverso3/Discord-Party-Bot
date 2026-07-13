import { ChevronsUpDown } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChannelInfo } from '../types'
import { cn } from '../lib/cn'

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
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 })

  const selected = channels.find(c => c.id === value)
  const unknown = value && !selected

  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const r = boxRef.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom, left: r.left, width: r.width })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (boxRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
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

  const itemCls = 'block w-full cursor-pointer rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent'

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        className={cn(
          'flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-sm shadow-sm transition-colors',
          'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none',
          !selected && !unknown && 'text-muted-foreground',
        )}
        onClick={() => { setOpen(o => !o); setQuery('') }}
      >
        <span className="truncate">
          {unknown ? `(unknown: ${value})` : selected ? `#${selected.name}` : allowNone ? '— none —' : (placeholder || 'Select a channel')}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          className="animate-fade-in fixed z-50 mt-1 overflow-hidden rounded-lg border bg-popover shadow-lg"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          <div className="border-b p-1.5">
            <input
              type="text"
              autoFocus
              className="h-8 w-full rounded-md bg-transparent px-2 text-sm focus:outline-none"
              placeholder={placeholder || 'Search channels…'}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
            />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {allowNone && (
              <button type="button" className={cn(itemCls, 'text-muted-foreground')} onClick={() => pick('')}>— none —</button>
            )}
            {filtered.map(c => (
              <button key={c.id} type="button" className={itemCls} onClick={() => pick(c.id)}>#{c.name}</button>
            ))}
            {filtered.length === 0 && <div className="px-2.5 py-2 text-sm text-muted-foreground">No channels match</div>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
