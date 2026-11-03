import { Search } from 'lucide-react'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { api, isSnowflake } from '../api'
import type { MemberHit } from '../types'
import { cn } from '@/lib/utils'
import { Avatar } from './Avatar'
import { Mono } from './common'
import { Input } from './ui/input'
import { Popover, PopoverAnchor, PopoverContent } from './ui/popover'

export interface UserPickerHandle {
  /** The chosen/pasted user ID, or '' if neither. */
  getId(): string
  setValue(v: string): void
  clear(): void
}

interface Props {
  placeholder: string
  onPick?: (u: MemberHit) => void
  className?: string
}

/**
 * Input that searches guild members by name (debounced) and also accepts a
 * pasted user ID. Results render in a popover so dialogs and cards never clip them.
 */
export const UserPicker = forwardRef<UserPickerHandle, Props>(function UserPicker({ placeholder, onPick, className }, ref) {
  const [value, setValue] = useState('')
  const [results, setResults] = useState<MemberHit[]>([])
  const [active, setActive] = useState(0)
  const chosen = useRef<MemberHit | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const close = () => setResults([])

  useImperativeHandle(ref, () => ({
    getId() {
      if (chosen.current) return chosen.current.id
      const v = valueRef.current.trim()
      return isSnowflake(v) ? v : ''
    },
    setValue(v: string) { chosen.current = null; setValue(v) },
    clear() { chosen.current = null; setValue(''); close() },
  }))

  // getId is called from parent event handlers after re-renders; keep the
  // latest value reachable without re-creating the handle.
  const valueRef = useRef(value)
  valueRef.current = value

  const onInput = (v: string) => {
    setValue(v)
    chosen.current = null
    clearTimeout(timer.current)
    const q = v.trim()
    if (q.length < 2 || isSnowflake(q)) return close()
    timer.current = setTimeout(async () => {
      let hits: MemberHit[] = []
      try { hits = await api<MemberHit[]>('/members?q=' + encodeURIComponent(q)) } catch { /* keep closed */ }
      if (valueRef.current.trim() !== q) return  // stale response
      setResults(hits)
      setActive(0)
    }, 300)
  }

  const pick = (u: MemberHit) => {
    chosen.current = u
    setValue(`${u.displayName} (${u.id})`)
    close()
    onPick?.(u)
  }

  const open = results.length > 0

  return (
    <Popover open={open} onOpenChange={o => { if (!o) close() }}>
      <PopoverAnchor asChild>
        <div className={cn('relative', className)}>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            className="pl-8"
            placeholder={placeholder}
            autoComplete="off"
            value={value}
            onChange={e => onInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') close()
              if (!open) return
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, results.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
              if (e.key === 'Enter') { e.preventDefault(); pick(results[active]!) }
            }}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-64 p-1"
        onOpenAutoFocus={e => e.preventDefault()}
        onInteractOutside={e => {
          // Clicking back into the input shouldn't close the list.
          if ((e.target as HTMLElement).closest?.('[data-slot=input]')) e.preventDefault()
        }}
      >
        <div role="listbox" className="max-h-64 overflow-y-auto">
          {results.map((u, i) => (
            <button
              key={u.id}
              type="button"
              role="option"
              aria-selected={i === active}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm outline-none',
                i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
              )}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(u)}
            >
              <Avatar name={u.displayName} className="size-6" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{u.displayName}</span>
                <span className="block truncate text-xs text-muted-foreground">@{u.username}</span>
              </span>
              <Mono className="hidden sm:inline">{u.id}</Mono>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
})
