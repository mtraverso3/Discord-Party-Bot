import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { GAMES } from '../games'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { UserPicker, type UserPickerHandle } from '../components/UserPicker'
import { ChannelSelect } from '../components/ChannelSelect'
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

  if (error) return <article>Error: {error}</article>
  if (!templates) return <progress />

  const upsert = (t: PartyTemplate) => setTemplates(ts => {
    if (!ts) return [t]
    const i = ts.findIndex(x => x.id === t.id)
    if (i === -1) return [...ts, t]
    const next = ts.slice()
    next[i] = t
    return next
  })

  return (
    <div>
      <div className="toolbar">
        <span className="muted grow">
          Reusable party blueprints — build one, then spin up a party for any member without re-entering everything.
        </span>
        <button className="tiny" onClick={() => setShowCreate(s => !s)}>New template</button>
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
        <div className="empty">No templates yet. Create one to get started.</div>
      ) : (
        templates.map(t => (
          <TemplateCard
            key={t.id}
            t={t}
            settings={settings}
            voiceChannels={voiceChannels}
            textChannels={textChannels}
            onSaved={upsert}
            onDeleted={id => setTemplates(ts => ts ? ts.filter(x => x.id !== id) : ts)}
          />
        ))
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
  const [showEdit, setShowEdit] = useState(false)
  const [showApply, setShowApply] = useState(false)

  return (
    <details className="party">
      <summary>
        <div className="summary-row">
          <span className="name">{t.label}</span>
          <span className="chip">{t.game}</span>
          <span className="chip">cap {t.maxSize}</span>
          {t.banlist && <span className="chip chip-warn">banlist</span>}
          <span className="grow" />
          <span className="uid">{t.id}</span>
        </div>
      </summary>
      <div className="body">
        {t.name
          ? <p><strong>Party title: </strong>{t.name}</p>
          : <p className="muted">No fixed title — defaults to the owner's name.</p>}
        {t.description && <p className="muted">{t.description}</p>}
        <div className="toolbar">
          <button type="button" className="tiny" onClick={() => setShowApply(s => !s)}>Use template…</button>
          <button type="button" className="tiny ghost" onClick={() => setShowEdit(s => !s)}>Edit</button>
          <span className="grow" />
          <button
            type="button"
            className="tiny ghost-danger"
            onClick={async () => {
              if (!(await confirm(`Delete template "${t.label}"?`, 'Delete'))) return
              try {
                await api('/templates/' + t.id, { method: 'DELETE' })
                onDeleted(t.id)
                toast('Template deleted')
              } catch (e) { toast((e as Error).message, 'err') }
            }}
          >
            Delete
          </button>
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
    </details>
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
    <article>
      <h5>{t ? 'Edit template' : 'New template'}</h5>
      <form className="grid-2" onSubmit={e => { e.preventDefault(); if (!busy) submit() }}>
        <label>Template label<input value={label} placeholder="e.g. Friday ARAM" maxLength={100} required onChange={e => setLabel(e.target.value)} /></label>
        <label>Party title<input value={name} placeholder="Party title (optional)" maxLength={100} onChange={e => setName(e.target.value)} /></label>
        <label>Game
          <select value={game} onChange={e => setGame(e.target.value)}>
            {allowed.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label>Player cap<input type="number" min={2} max={50} value={cap} onChange={e => setCap(Number(e.target.value))} /></label>
        <label className="span-2">Voice channel
          <ChannelSelect channels={voiceChannels} value={voice} onChange={setVoice} allowNone />
        </label>
        <label className="span-2">Description<textarea value={desc} placeholder="Description (optional)" onChange={e => setDesc(e.target.value)} /></label>
        <label className="span-2">Banlist<textarea className="bans" value={bans} placeholder="One champion per line (optional)" onChange={e => setBans(e.target.value)} /></label>
        <div className="span-2 toolbar">
          <button type="submit" disabled={busy} aria-busy={busy}>
            {busy ? (t ? 'Saving…' : 'Creating…') : (t ? 'Save template' : 'Create template')}
          </button>
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </article>
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
    <article>
      <h5>Use "{t.label}"</h5>
      <form className="grid-2" onSubmit={e => { e.preventDefault(); if (!busy) submit() }}>
        <label className="span-2">Assign to<UserPicker ref={ownerPicker} placeholder="Search member by name, or paste an ID" /></label>
        <label>Post embed in
          <ChannelSelect channels={textChannels} value={channel || textChannels[0]?.id || ''} onChange={setChannel} />
        </label>
        <label>Voice channel
          <ChannelSelect channels={voiceChannels} value={voice} onChange={setVoice} allowNone />
        </label>
        <div className="span-2 toolbar">
          <button type="submit" disabled={busy} aria-busy={busy}>{busy ? 'Creating…' : 'Create party'}</button>
          <button type="button" className="secondary" onClick={onDone}>Cancel</button>
        </div>
      </form>
    </article>
  )
}
