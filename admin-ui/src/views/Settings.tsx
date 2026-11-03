import { Megaphone, MonitorSmartphone, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { useToast } from '../components/Toast'
import { UserPicker, type UserPickerHandle } from '../components/UserPicker'
import { ErrorNote, Field, PageSkeleton } from '../components/common'
import { Avatar } from '../components/Avatar'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { useGuildData } from '../lib/guildData'
import { useLoad } from '../lib/useLoad'
import type { GuildSettings } from '../types'

export function Settings() {
  const guildData = useGuildData()
  const { data: settings, error } = useLoad(() => guildData.getSettings(true))
  if (error) return <ErrorNote>Error: {error}</ErrorNote>
  if (!settings) return <PageSkeleton rows={3} />
  return <SettingsForm initial={settings} />
}

function SettingsForm({ initial }: { initial: GuildSettings }) {
  const toast = useToast()
  const guildData = useGuildData()

  const [maxParties, setMaxParties] = useState(initial.maxParties)
  const [defaultCap, setDefaultCap] = useState(initial.defaultCap)
  const [inviters, setInviters] = useState<string[]>(initial.clientInviters || [])
  const [bumpers, setBumpers] = useState<string[]>(initial.partyBumpers || [])
  const [saved, setSaved] = useState(initial)
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

  const dirty =
    Number(maxParties) !== saved.maxParties ||
    Number(defaultCap) !== saved.defaultCap ||
    inviters.join() !== (saved.clientInviters || []).join() ||
    bumpers.join() !== (saved.partyBumpers || []).join()

  const chipList = (ids: string[], emptyText: string, onRemove: (id: string) => void) => (
    ids.length === 0
      ? <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">{emptyText}</p>
      : (
        <ul className="divide-y rounded-lg border">
          {ids.map(id => (
            <li key={id} className="flex items-center gap-3 px-3 py-2">
              <Avatar name={memberNames[id] || id} className="size-7" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{memberNames[id] || id}</span>
                {memberNames[id] && <span className="block font-mono text-xs text-muted-foreground">{id}</span>}
              </span>
              <Button variant="ghost" size="icon-sm" className="hover:text-destructive" aria-label="Remove" onClick={() => onRemove(id)}>
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )
  )

  const save = async () => {
    setSaving(true)
    try {
      const s = await api<GuildSettings>('/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          maxParties: Number(maxParties),
          defaultCap: Number(defaultCap),
          clientInviters: inviters,
          partyBumpers: bumpers,
        }),
      })
      guildData.setSettings(s)
      setSaved(s)
      toast('Settings saved')
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="max-w-3xl space-y-4 pb-20" onSubmit={e => { e.preventDefault(); save() }}>
      <Card>
        <CardHeader>
          <CardTitle>Party limits</CardTitle>
          <CardDescription>Enforced by the bot when members create or edit parties.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Max concurrent parties" hint="Between 1 and 50.">
            <Input type="number" min={1} max={50} value={maxParties} onChange={e => setMaxParties(Number(e.target.value))} />
          </Field>
          <Field label="Default player cap" hint="Pre-filled in the create modal. Between 2 and 50.">
            <Input type="number" min={2} max={50} value={defaultCap} onChange={e => setDefaultCap(Number(e.target.value))} />
          </Field>
        </CardContent>
      </Card>

      <AllowList
        icon={<MonitorSmartphone />}
        title="Desktop client inviters"
        description="Party owners can always send League lobby invites from the desktop client. Members listed here can too."
      >
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
      </AllowList>

      <AllowList
        icon={<Megaphone />}
        title="Party bumpers"
        description="Party owners can always bump their own party. Members listed here can run /party bump on any party they belong to, even when they are not the owner."
      >
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
      </AllowList>

      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
        <span className="text-sm text-muted-foreground">{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
        <Button type="submit" busy={saving} disabled={!dirty && !saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
      </div>
    </form>
  )
}

function AllowList({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="grid-cols-[auto_1fr] gap-x-3">
        <span className="row-span-2 flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:size-4">{icon}</span>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  )
}
