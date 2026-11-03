import { Ellipsis, FileStack, Mic, Pencil, Play, Plus, ShieldCheck, Ban, Trash2, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { defaultGame, gameChoices } from '../games'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { UserPicker, type UserPickerHandle } from '../components/UserPicker'
import { ChannelSelect } from '../components/ChannelSelect'
import { CheckboxCard, EmptyState, ErrorNote, Field, GameSelect, Mono, PageSkeleton } from '../components/common'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { useGuildData } from '../lib/guildData'
import { useLoad } from '../lib/useLoad'
import type { ChannelInfo, GuildSettings, Party, PartyTemplate } from '../types'

type Modal = { kind: 'create' } | { kind: 'edit'; t: PartyTemplate } | { kind: 'apply'; t: PartyTemplate } | null

export function Templates() {
  const guildData = useGuildData()
  const { data: templates, setData: setTemplates, error } = useLoad(() => api<PartyTemplate[]>('/templates'))
  const [settings, setSettings] = useState<GuildSettings | null>(null)
  const [voiceChannels, setVoiceChannels] = useState<ChannelInfo[]>([])
  const [textChannels, setTextChannels] = useState<ChannelInfo[]>([])
  const [modal, setModal] = useState<Modal>(null)
  const toast = useToast()
  const confirm = useConfirm()

  useEffect(() => {
    guildData.getSettings().then(setSettings).catch(() => {})
    guildData.getVoiceChannels().then(setVoiceChannels).catch(() => {})
    guildData.getTextChannels().then(setTextChannels).catch(() => {})
  }, [guildData])

  if (error) return <ErrorNote>Error: {error}</ErrorNote>
  if (!templates) return <PageSkeleton rows={3} />

  const upsert = (t: PartyTemplate) => setTemplates(ts => {
    if (!ts) return [t]
    const i = ts.findIndex(x => x.id === t.id)
    if (i === -1) return [...ts, t]
    const next = ts.slice()
    next[i] = t
    return next
  })

  const remove = async (t: PartyTemplate) => {
    if (!(await confirm(`Delete template "${t.label}"?`, 'Delete'))) return
    try {
      await api('/templates/' + t.id, { method: 'DELETE' })
      setTemplates(ts => ts ? ts.filter(x => x.id !== t.id) : ts)
      toast('Template deleted')
    } catch (e) { toast((e as Error).message, 'err') }
  }

  const voiceName = (id?: string) => voiceChannels.find(c => c.id === id)?.name

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {templates.length} {templates.length === 1 ? 'template' : 'templates'}
        </p>
        <Button onClick={() => setModal({ kind: 'create' })}><Plus />New template</Button>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={<FileStack />}
          title="No templates yet"
          action={<Button size="sm" onClick={() => setModal({ kind: 'create' })}><Plus />New template</Button>}
        >
          Save a party's title, game, cap, voice channel and banlist once, then spin it up for anyone.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {templates.map(t => (
            <Card key={t.id} className="gap-4">
              <CardHeader>
                <CardTitle className="truncate">{t.label}</CardTitle>
                <CardDescription className="truncate">
                  {t.name ? t.name : <span className="italic">Title defaults to the owner's name</span>}
                </CardDescription>
                <CardAction>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${t.label}`}><Ellipsis /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setModal({ kind: 'edit', t })}><Pencil />Edit</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => remove(t)}><Trash2 />Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardAction>
              </CardHeader>
              <CardContent className="flex-1 space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{t.game}</Badge>
                  <Badge variant="secondary"><Users />Cap {t.maxSize}</Badge>
                  {t.voiceChannelId && <Badge variant="secondary"><Mic />{voiceName(t.voiceChannelId) ?? 'Voice'}</Badge>}
                  {t.banlist && <Badge variant="warning"><Ban />Banlist</Badge>}
                  {t.rulesRequired && <Badge variant="primary"><ShieldCheck />Rules check</Badge>}
                </div>
                {t.description && <p className="line-clamp-3 text-sm whitespace-pre-line text-muted-foreground">{t.description}</p>}
              </CardContent>
              <CardFooter className="justify-between gap-2 border-t [.border-t]:pt-4">
                <Mono>{t.id}</Mono>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setModal({ kind: 'edit', t })}><Pencil />Edit</Button>
                  <Button size="sm" onClick={() => setModal({ kind: 'apply', t })}><Play />Use template</Button>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={modal !== null} onOpenChange={o => { if (!o) setModal(null) }}>
        <DialogContent className={modal?.kind === 'apply' ? 'sm:max-w-lg' : 'sm:max-w-2xl'}>
          {modal?.kind === 'apply' ? (
            <>
              <DialogHeader>
                <DialogTitle>Use “{modal.t.label}”</DialogTitle>
                <DialogDescription>Create a party from this template for a member.</DialogDescription>
              </DialogHeader>
              <ApplyForm t={modal.t} voiceChannels={voiceChannels} textChannels={textChannels} onDone={() => setModal(null)} />
            </>
          ) : modal ? (
            <>
              <DialogHeader>
                <DialogTitle>{modal.kind === 'edit' ? 'Edit template' : 'New template'}</DialogTitle>
                <DialogDescription>Parties made from a template start with these settings.</DialogDescription>
              </DialogHeader>
              <TemplateForm
                key={modal.kind === 'edit' ? modal.t.id : 'new'}
                t={modal.kind === 'edit' ? modal.t : undefined}
                settings={settings}
                voiceChannels={voiceChannels}
                onSaved={x => { upsert(x); setModal(null) }}
                onCancel={() => setModal(null)}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
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
  const s = settings || { defaultCap: 10 }
  const allowed = gameChoices(settings, t?.game)

  const [label, setLabel] = useState(t?.label || '')
  const [name, setName] = useState(t?.name || '')
  const [game, setGame] = useState(t?.game || defaultGame(settings))
  const [cap, setCap] = useState(t?.maxSize || s.defaultCap)
  const [voice, setVoice] = useState(t?.voiceChannelId || '')
  const [desc, setDesc] = useState(t?.description || '')
  const [bans, setBans] = useState(t?.banlist || '')
  const [rules, setRules] = useState(t?.rulesRequired ?? false)
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
      rulesRequired: rules,
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
    <form className="grid gap-5" onSubmit={e => { e.preventDefault(); if (!busy) submit() }}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Template label"><Input value={label} placeholder="e.g. Friday ARAM" maxLength={100} required onChange={e => setLabel(e.target.value)} /></Field>
        <Field label="Party title"><Input value={name} placeholder="Optional" maxLength={100} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Game"><GameSelect value={game} onChange={setGame} games={allowed} /></Field>
        <Field label="Player cap"><Input type="number" min={2} max={50} value={cap} onChange={e => setCap(Number(e.target.value))} /></Field>
        <Field label="Voice channel" className="sm:col-span-2">
          <ChannelSelect channels={voiceChannels} value={voice} onChange={setVoice} allowNone />
        </Field>
        <Field label="Description" className="sm:col-span-2"><Textarea value={desc} placeholder="Optional" onChange={e => setDesc(e.target.value)} /></Field>
        <Field label="Banlist" hint="One champion per line, assigned to members in join order." className="sm:col-span-2">
          <Textarea className="min-h-28 font-mono text-xs" value={bans} placeholder="Optional" onChange={e => setBans(e.target.value)} />
        </Field>
        <CheckboxCard
          className="sm:col-span-2"
          checked={rules}
          onCheckedChange={setRules}
          title="Require the rules check"
          description="Parties made from this template only admit members who have passed. Needs the check switched on for the server, under Rules & verification."
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" busy={busy}>
          {busy ? (t ? 'Saving…' : 'Creating…') : (t ? 'Save template' : 'Create template')}
        </Button>
      </DialogFooter>
    </form>
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
    <form className="grid gap-5" onSubmit={e => { e.preventDefault(); if (!busy) submit() }}>
      <div className="grid gap-4">
        <Field label="Assign to"><UserPicker ref={ownerPicker} placeholder="Search by name, or paste an ID" /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Post embed in">
            <ChannelSelect channels={textChannels} value={channel || textChannels[0]?.id || ''} onChange={setChannel} />
          </Field>
          <Field label="Voice channel">
            <ChannelSelect channels={voiceChannels} value={voice} onChange={setVoice} allowNone />
          </Field>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" busy={busy}>{busy ? 'Creating…' : 'Create party'}</Button>
      </DialogFooter>
    </form>
  )
}
