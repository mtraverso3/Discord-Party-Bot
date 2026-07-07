import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { GAMES } from '../games'
import { useToast } from '../components/Toast'
import { UserPicker, type UserPickerHandle } from '../components/UserPicker'
import { useGuildData } from '../lib/guildData'
import { useLoad } from '../lib/useLoad'
import type { GuildSettings } from '../types'

export function Settings() {
  const guildData = useGuildData()
  const { data: settings, error } = useLoad(() => guildData.getSettings(true))
  if (error) return <article>Error: {error}</article>
  if (!settings) return <progress />
  return <SettingsForm initial={settings} />
}

function SettingsForm({ initial }: { initial: GuildSettings }) {
  const toast = useToast()
  const guildData = useGuildData()

  const [maxParties, setMaxParties] = useState(initial.maxParties)
  const [defaultCap, setDefaultCap] = useState(initial.defaultCap)
  const [allowedGames, setAllowedGames] = useState<string[]>(initial.allowedGames)
  const [inviters, setInviters] = useState<string[]>(initial.clientInviters || [])
  const [bumpers, setBumpers] = useState<string[]>(initial.partyBumpers || [])
  // User-ID allowlists share one name cache; fall back to the raw ID.
  const [memberNames, setMemberNames] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const inviterPicker = useRef<UserPickerHandle>(null)
  const bumperPicker = useRef<UserPickerHandle>(null)

  // Resolve every listed ID to a name in one batched request.
  useEffect(() => {
    const allIds = [...new Set([...(initial.clientInviters || []), ...(initial.partyBumpers || [])])]
    if (allIds.length === 0) return
    api<Record<string, string>>('/members/resolve?ids=' + encodeURIComponent(allIds.join(',')))
      .then(map => setMemberNames(n => ({ ...n, ...(map || {}) })))
      .catch(() => { /* leave raw IDs */ })
  }, [initial])

  const toggleGame = (g: string, on: boolean) =>
    setAllowedGames(gs => on ? [...gs, g] : gs.filter(x => x !== g))

  const chipList = (ids: string[], emptyText: string, onRemove: (id: string) => void) => (
    <div className="inviter-list">
      {ids.length === 0
        ? <span className="muted">{emptyText}</span>
        : ids.map(id => (
            <span key={id} className="chip">
              {memberNames[id] || id}
              <button type="button" className="chip-x" title="Remove" onClick={() => onRemove(id)}>×</button>
            </span>
          ))}
    </div>
  )

  const save = async () => {
    setSaving(true)
    try {
      const s = await api<GuildSettings>('/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          maxParties: Number(maxParties),
          defaultCap: Number(defaultCap),
          allowedGames,
          clientInviters: inviters,
          partyBumpers: bumpers,
        }),
      })
      guildData.setSettings(s)
      toast('Settings saved')
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <article>
      <h5>Guild settings</h5>
      <p className="muted">These are enforced by the bot when members create or edit parties.</p>
      <form onSubmit={e => { e.preventDefault(); save() }}>
        <div className="grid-2">
          <label>
            Max concurrent parties (1–50)
            <input type="number" min={1} max={50} value={maxParties} onChange={e => setMaxParties(Number(e.target.value))} />
          </label>
          <label>
            Default player cap in create modal (2–50)
            <input type="number" min={2} max={50} value={defaultCap} onChange={e => setDefaultCap(Number(e.target.value))} />
          </label>
        </div>
        <h5>Allowed games</h5>
        <p className="muted">Leave all unchecked to allow every game.</p>
        <div className="grid-2">
          {GAMES.map(g => (
            <label key={g} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input type="checkbox" checked={allowedGames.includes(g)} onChange={e => toggleGame(g, e.target.checked)} />
              {g}
            </label>
          ))}
        </div>
        <h5>Desktop client inviters</h5>
        <p className="muted">Party owners can always send League lobby invites from the desktop client. Members listed here can too.</p>
        {chipList(inviters, 'No extra inviters — only party owners can invite.', id => setInviters(l => l.filter(x => x !== id)))}
        <UserPicker
          ref={inviterPicker}
          placeholder="Add a member who may lobby-invite from the desktop client"
          onPick={u => {
            setInviters(l => l.includes(u.id) ? l : [...l, u.id])
            setMemberNames(n => ({ ...n, [u.id]: u.displayName }))
            inviterPicker.current?.clear()
          }}
        />
        <h5>Party bumpers</h5>
        <p className="muted">Party owners can always bump their own party. Members listed here can run /party bump on any party they belong to, even when they are not the owner.</p>
        {chipList(bumpers, 'No extra bumpers — only party owners can bump.', id => setBumpers(l => l.filter(x => x !== id)))}
        <UserPicker
          ref={bumperPicker}
          placeholder="Add a member who may bump any party they are in"
          onPick={u => {
            setBumpers(l => l.includes(u.id) ? l : [...l, u.id])
            setMemberNames(n => ({ ...n, [u.id]: u.displayName }))
            bumperPicker.current?.clear()
          }}
        />
        <div className="toolbar">
          <button type="submit" disabled={saving} aria-busy={saving}>Save settings</button>
        </div>
      </form>
    </article>
  )
}
