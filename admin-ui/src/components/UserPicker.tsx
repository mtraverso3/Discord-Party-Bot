import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { api, isSnowflake } from '../api'
import type { MemberHit } from '../types'

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
    <div className="upick">
      <input
        type="text"
        placeholder={placeholder}
        autoComplete="off"
        value={value}
        onChange={e => onInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') close() }}
      />
      {results.length > 0 && (
        <div className="upick-list">
          {results.map(u => (
            <button key={u.id} type="button" className="upick-item" onClick={() => pick(u)}>
              <strong>{u.displayName}</strong>
              <span className="muted">@{u.username}</span>
              <span className="uid">{u.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
