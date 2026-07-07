import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { api, isSnowflake } from '../api'
import type { MemberHit } from '../types'
import { Input, Mono } from './ui'

export interface UserPickerHandle {
  /** The chosen/pasted user ID, or '' if neither. */
  getId(): string
  setValue(v: string): void
  clear(): void
}

interface Props {
  placeholder: string
  onPick?: (u: MemberHit) => void
}

/**
 * Input that searches guild members by name (debounced) and also accepts a
 * pasted user ID.
 */
export const UserPicker = forwardRef<UserPickerHandle, Props>(function UserPicker({ placeholder, onPick }, ref) {
  const [value, setValue] = useState('')
  const [results, setResults] = useState<MemberHit[]>([])
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
    }, 300)
  }

  const pick = (u: MemberHit) => {
    chosen.current = u
    setValue(`${u.displayName} (${u.id})`)
    close()
    onPick?.(u)
  }

  return (
    <div className="relative">
      <Input
        type="text"
        placeholder={placeholder}
        autoComplete="off"
        value={value}
        onChange={e => onInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') close() }}
      />
      {results.length > 0 && (
        <div className="animate-fade-in absolute top-full right-0 left-0 z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
          {results.map(u => (
            <button
              key={u.id}
              type="button"
              className="flex w-full cursor-pointer items-baseline gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent"
              onClick={() => pick(u)}
            >
              <span className="font-medium">{u.displayName}</span>
              <span className="text-xs text-muted-foreground">@{u.username}</span>
              <Mono className="ml-auto">{u.id}</Mono>
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
