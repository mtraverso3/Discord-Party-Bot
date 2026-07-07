import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { GAMES } from '../games'
import { useToast } from '../components/Toast'
import { UserPicker, type UserPickerHandle } from '../components/UserPicker'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, ErrorNote, Input, Label, Spinner } from '../components/ui'
import { useGuildData } from '../lib/guildData'
import { useLoad } from '../lib/useLoad'
import type { GuildSettings } from '../types'

export function Settings() {
  const guildData = useGuildData()
  const { data: settings, error } = useLoad(() => guildData.getSettings(true))
  if (error) return <ErrorNote>Error: {error}</ErrorNote>
  if (!settings) return <Spinner />
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
    <div className="flex flex-wrap gap-1.5">
      {ids.length === 0
        ? <span className="text-xs text-muted-foreground">{emptyText}</span>
        : ids.map(id => (
            <Badge key={id} variant="secondary" className="py-1 pr-1 pl-2.5 text-xs">
              {memberNames[id] || id}
              <button
                type="button"
                className="ml-0.5 cursor-pointer rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-danger-muted hover:text-destructive"
                title="Remove"
                onClick={() => onRemove(id)}
              >
                <X className="size-3" />
              </button>
            </Badge>
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
    <form className="max-w-3xl space-y-4" onSubmit={e => { e.preventDefault(); save() }}>
      <Card>
        <CardHeader>
          <CardTitle>Party limits</CardTitle>
          <CardDescription>Enforced by the bot when members create or edit parties.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Label>
            Max concurrent parties (1–50)
            <Input type="number" min={1} max={50} value={maxParties} onChange={e => setMaxParties(Number(e.target.value))} />
          </Label>
          <Label>
            Default player cap in create modal (2–50)
            <Input type="number" min={2} max={50} value={defaultCap} onChange={e => setDefaultCap(Number(e.target.value))} />
          </Label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Allowed games</CardTitle>
          <CardDescription>Leave all unchecked to allow every game.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {GAMES.map(g => (
            <label key={g} className="flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent">
              <Checkbox checked={allowedGames.includes(g)} onChange={e => toggleGame(g, e.target.checked)} />
              {g}
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Desktop client inviters</CardTitle>
          <CardDescription>
            Party owners can always send League lobby invites from the desktop client. Members listed here can too.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Party bumpers</CardTitle>
          <CardDescription>
            Party owners can always bump their own party. Members listed here can run /party bump on any party they
            belong to, even when they are not the owner.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
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
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" busy={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
      </div>
    </form>
  )
}
