import { ChevronDown, FileStack, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { GAMES } from '../games'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { UserPicker, type UserPickerHandle } from '../components/UserPicker'
import { ChannelSelect } from '../components/ChannelSelect'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorNote, Input, Label, Mono, Select, Spinner, Textarea } from '../components/ui'
import { cn } from '../lib/cn'
import { useGuildData } from '../lib/guildData'
import { useLoad } from '../lib/useLoad'
import type { ChannelInfo, GuildSettings, Party, PartyTemplate } from '../types'

export function Templates() {
  const guildData = useGuildData()
  const { data: templates, setData: setTemplates, error } = useLoad(() => api<PartyTemplate[]>('/templates'))
  const [settings, setSettings] = useState<GuildSettings | null>(null)
  const [voiceChannels, setVoiceChannels] = useState<ChannelInfo[]>([])
  const [textChannels, setTextChannels] = useState<ChannelInfo[]>([])
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    guildData.getSettings().then(setSettings).catch(() => {})
    guildData.getVoiceChannels().then(setVoiceChannels).catch(() => {})
    guildData.getTextChannels().then(setTextChannels).catch(() => {})
  }, [guildData])

  if (error) return <ErrorNote>Error: {error}</ErrorNote>
  if (!templates) return <Spinner />

  const upsert = (t: PartyTemplate) => setTemplates(ts => {
    if (!ts) return [t]
    const i = ts.findIndex(x => x.id === t.id)
    if (i === -1) return [...ts, t]
    const next = ts.slice()
    next[i] = t
    return next
  })

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowCreate(s => !s)}><Plus />New template</Button>
      </div>
      {showCreate && (
        <TemplateForm
          settings={settings}
          voiceChannels={voiceChannels}
          onSaved={t => { upsert(t); setShowCreate(false) }}
          onCancel={() => setShowCreate(false)}
        />
      )}
      {templates.length === 0 ? (
        <EmptyState icon={<FileStack />} title="No templates yet">
          Create one to get started.
        </EmptyState>
      ) : (
        <div className="space-y-2.5">
          {templates.map(t => (
            <TemplateCard
              key={t.id}
              t={t}
              settings={settings}
              voiceChannels={voiceChannels}
              textChannels={textChannels}
              onSaved={upsert}
              onDeleted={id => setTemplates(ts => ts ? ts.filter(x => x.id !== id) : ts)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TemplateCard({ t, settings, voiceChannels, textChannels, onSaved, onDeleted }: {
  t: PartyTemplate
  settings: GuildSettings | null
  voiceChannels: ChannelInfo[]
  textChannels: ChannelInfo[]
  onSaved: (t: PartyTemplate) => void
  onDeleted: (id: string) => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [open, setOpen] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showApply, setShowApply] = useState(false)

  return (
    <Card className={cn('overflow-hidden transition-colors', open && 'border-primary/40')}>
      <button
        type="button"
        className="flex w-full cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="text-sm font-semibold">{t.label}</span>
        <Badge variant="outline">{t.game}</Badge>
        <Badge variant="secondary">cap {t.maxSize}</Badge>
        {t.banlist && <Badge variant="warning">banlist</Badge>}
        <span className="grow" />
        <Mono className="hidden sm:inline">{t.id}</Mono>
        <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-4 border-t px-4 py-4">
          <div className="text-sm">
            {t.name
              ? <p><span className="font-medium">Party title: </span>{t.name}</p>
              : <p className="text-muted-foreground">No fixed title — defaults to the owner's name.</p>}
            {t.description && <p className="mt-1 text-muted-foreground whitespace-pre-line">{t.description}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => { setShowApply(s => !s); setShowEdit(false) }}><Play />Use template…</Button>
            <Button variant="outline" size="sm" onClick={() => { setShowEdit(s => !s); setShowApply(false) }}><Pencil />Edit</Button>
            <span className="grow" />
            <Button
              variant="destructive-outline"
              size="sm"
              onClick={async () => {
                if (!(await confirm(`Delete template "${t.label}"?`, 'Delete'))) return
                try {
                  await api('/templates/' + t.id, { method: 'DELETE' })
                  onDeleted(t.id)
                  toast('Template deleted')
                } catch (e) { toast((e as Error).message, 'err') }
              }}
            >
              <Trash2 />Delete
            </Button>
          </div>
          {showApply && <ApplyForm t={t} voiceChannels={voiceChannels} textChannels={textChannels} onDone={() => setShowApply(false)} />}
          {showEdit && (
            <TemplateForm
              t={t}
              settings={settings}
              voiceChannels={voiceChannels}
              onSaved={x => { onSaved(x); setShowEdit(false) }}
              onCancel={() => setShowEdit(false)}
            />
          )}
        </div>
      )}
    </Card>
  )
}

function TemplateForm({ t, settings, voiceChannels, onSaved, onCancel }: {
  t?: PartyTemplate
  settings: GuildSettings | null
  voiceChannels: ChannelInfo[]
  onSaved: (t: PartyTemplate) => void
  onCancel: () => void
}) {
  const toast = useToast()
  const s = settings || { defaultCap: 10, allowedGames: [] as string[] }
  const allowed = GAMES.filter(g => s.allowedGames.length === 0 || s.allowedGames.includes(g))

  const [label, setLabel] = useState(t?.label || '')
  const [name, setName] = useState(t?.name || '')
  const [game, setGame] = useState(t?.game || 'Other')
  const [cap, setCap] = useState(t?.maxSize || s.defaultCap)
  const [voice, setVoice] = useState(t?.voiceChannelId || '')
  const [desc, setDesc] = useState(t?.description || '')
  const [bans, setBans] = useState(t?.banlist || '')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!label.trim()) return toast('A template label is required.', 'err')
    setBusy(true)
    const payload = {
      label, name, game,
      maxSize: Number(cap),
      voiceChannelId: voice || undefined,
      description: desc,
      banlist: bans,
    }
    try {
      const saved = t
        ? await api<PartyTemplate>('/templates/' + t.id, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api<PartyTemplate>('/templates', { method: 'POST', body: JSON.stringify(payload) })
      toast(t ? 'Template saved' : 'Template created')
      onSaved(saved)
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="animate-fade-in border-primary/30">
      <CardHeader><CardTitle>{t ? 'Edit template' : 'New template'}</CardTitle></CardHeader>
      <CardContent>
        <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); if (!busy) submit() }}>
          <Label>Template label<Input value={label} placeholder="e.g. Friday ARAM" maxLength={100} required onChange={e => setLabel(e.target.value)} /></Label>
          <Label>Party title<Input value={name} placeholder="Party title (optional)" maxLength={100} onChange={e => setName(e.target.value)} /></Label>
          <Label>Game
            <Select value={game} onChange={e => setGame(e.target.value)}>
              {allowed.map(g => <option key={g} value={g}>{g}</option>)}
            </Select>
          </Label>
          <Label>Player cap<Input type="number" min={2} max={50} value={cap} onChange={e => setCap(Number(e.target.value))} /></Label>
          <Label className="sm:col-span-2">Voice channel
            <ChannelSelect channels={voiceChannels} value={voice} onChange={setVoice} allowNone />
          </Label>
          <Label className="sm:col-span-2">Description<Textarea value={desc} placeholder="Description (optional)" onChange={e => setDesc(e.target.value)} /></Label>
          <Label className="sm:col-span-2">Banlist<Textarea className="min-h-28 font-mono text-xs" value={bans} placeholder="One champion per line (optional)" onChange={e => setBans(e.target.value)} /></Label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" busy={busy}>
              {busy ? (t ? 'Saving…' : 'Creating…') : (t ? 'Save template' : 'Create template')}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function ApplyForm({ t, voiceChannels, textChannels, onDone }: {
  t: PartyTemplate
  voiceChannels: ChannelInfo[]
  textChannels: ChannelInfo[]
  onDone: () => void
}) {
  const toast = useToast()
  const ownerPicker = useRef<UserPickerHandle>(null)
  const [channel, setChannel] = useState('')
  const [voice, setVoice] = useState(t.voiceChannelId || '')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const ownerId = ownerPicker.current?.getId()
    if (!ownerId) return toast('Pick an owner from the list or paste a user ID.', 'err')
    setBusy(true)
    try {
      const party = await api<Party>('/templates/' + t.id + '/apply', {
        method: 'POST',
        body: JSON.stringify({
          ownerId,
          channelId: channel || textChannels[0]?.id,
          voiceChannelId: voice || undefined,
        }),
      })
      onDone()
      // Drop the admin on the Parties tab so they can see the new party —
      // rather than leaving them staring at the template form with no sign
      // anything happened (which led to double-clicks and duplicates).
      toast(`Party "${party?.name ?? t.label}" created — see Parties`)
      location.hash = '#/parties'
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="animate-fade-in border-primary/30">
      <CardHeader><CardTitle>Use "{t.label}"</CardTitle></CardHeader>
      <CardContent>
        <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); if (!busy) submit() }}>
          <Label className="sm:col-span-2">Assign to<UserPicker ref={ownerPicker} placeholder="Search member by name, or paste an ID" /></Label>
          <Label>Post embed in
            <ChannelSelect channels={textChannels} value={channel || textChannels[0]?.id || ''} onChange={setChannel} />
          </Label>
          <Label>Voice channel
            <ChannelSelect channels={voiceChannels} value={voice} onChange={setVoice} allowNone />
          </Label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" busy={busy}>{busy ? 'Creating…' : 'Create party'}</Button>
            <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
