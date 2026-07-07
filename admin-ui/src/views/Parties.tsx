import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { GAMES } from '../games'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { Avatar } from '../components/Avatar'
import { UserPicker, type UserPickerHandle } from '../components/UserPicker'
import { useGuildData } from '../lib/guildData'
import { deadlineOf, fmtAbs, relTime } from '../lib/time'
import type { ChannelInfo, GuildSettings, Party, PartyMember, QueueEntry, VoiceStatus } from '../types'

type SortMode = 'newest' | 'oldest' | 'fullest' | 'expiring'

const SORTS: [SortMode, string][] = [
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['fullest', 'Fullest first'],
  ['expiring', 'Expiring soonest'],
]

export function Parties() {
  const toast = useToast()
  const confirm = useConfirm()
  const guildData = useGuildData()

  const [parties, setParties] = useState<Party[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<GuildSettings | null>(null)
  const [voiceChannels, setVoiceChannels] = useState<ChannelInfo[]>([])
  const [textChannels, setTextChannels] = useState<ChannelInfo[]>([])
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortMode>(() => (localStorage.getItem('pb-sort') as SortMode) || 'newest')
  const [auto, setAuto] = useState(() => localStorage.getItem('pb-autorefresh') === '1')
  const [showCreate, setShowCreate] = useState(false)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    try {
      setParties(await api<Party[]>('/parties'))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    refresh()
    guildData.getSettings().then(setSettings).catch(() => {})
    guildData.getVoiceChannels().then(setVoiceChannels).catch(() => {})
    guildData.getTextChannels().then(setTextChannels).catch(() => {})
  }, [refresh, guildData])

  useEffect(() => {
    if (!auto) return
    const t = setInterval(() => {
      api<Party[]>('/parties').then(setParties).catch(() => {})
    }, 10000)
    return () => clearInterval(t)
  }, [auto])

  // Most mutation endpoints return the updated party — patch it into the local
  // cache instead of re-fetching every party (one DO round-trip each).
  const applyUpdate = useCallback((p: Party | null) => {
    if (!p || !p.id) { refresh(); return }
    setParties(ps => {
      if (!ps) return ps
      const i = ps.findIndex(x => x.id === p.id)
      if (i === -1) return [...ps, p]
      const next = ps.slice()
      next[i] = p
      return next
    })
  }, [refresh])

  const removeLocal = useCallback((id: string) => {
    setParties(ps => ps ? ps.filter(p => p.id !== id) : ps)
  }, [])

  if (error && !parties) return <article>Error: {error}</article>
  if (!parties) return <progress />

  const filtered = applyFilterSort(parties, query, sort)

  return (
    <div>
      <div className="toolbar">
        <div className="grow">
          <input
            type="search"
            placeholder="Filter by name, game, or ID"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <select
          value={sort}
          onChange={e => {
            const v = e.target.value as SortMode
            setSort(v)
            localStorage.setItem('pb-sort', v)
          }}
        >
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <input
            type="checkbox"
            role="switch"
            checked={auto}
            onChange={e => {
              setAuto(e.target.checked)
              localStorage.setItem('pb-autorefresh', e.target.checked ? '1' : '0')
            }}
          />
          Auto
        </label>
        <button className="tiny ghost" onClick={refresh}>Refresh</button>
        <button className="tiny" onClick={() => setShowCreate(s => !s)}>New party</button>
        <button
          className="tiny ghost-danger"
          onClick={async () => {
            if (!(await confirm('Disband ALL parties in this guild? This cannot be undone.', 'Disband all'))) return
            try {
              await api('/clear', { method: 'POST' })
              toast('Cleared')
              refresh()
            } catch (e) { toast((e as Error).message, 'err') }
          }}
        >
          Clear all…
        </button>
      </div>

      {showCreate && (
        <CreateForm
          settings={settings}
          voiceChannels={voiceChannels}
          textChannels={textChannels}
          onCreated={p => { applyUpdate(p); setShowCreate(false) }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {parties.length === 0 ? (
        <div className="empty">No active parties.</div>
      ) : (
        <div>
          <p className="muted" style={{ margin: '0.25rem 0' }}>
            {filtered.length === parties.length
              ? `${parties.length} ${parties.length === 1 ? 'party' : 'parties'}`
              : `${filtered.length} of ${parties.length} parties`}
          </p>
          {filtered.map(p => (
            <PartyCard
              key={p.id}
              party={p}
              open={openIds.has(p.id)}
              onToggle={open => setOpenIds(ids => {
                const next = new Set(ids)
                if (open) next.add(p.id); else next.delete(p.id)
                return next
              })}
              voiceChannels={voiceChannels}
              onUpdate={applyUpdate}
              onRemove={removeLocal}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function applyFilterSort(parties: Party[], query: string, sort: SortMode): Party[] {
  let out = parties.slice()
  const q = query.trim().toLowerCase()
  if (q) {
    out = out.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.game.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q))
  }
  if (sort === 'newest') out.sort((a, b) => b.createdAt - a.createdAt)
  else if (sort === 'oldest') out.sort((a, b) => a.createdAt - b.createdAt)
  else if (sort === 'fullest') out.sort((a, b) => (b.members.length / b.maxSize) - (a.members.length / a.maxSize))
  else if (sort === 'expiring') out.sort((a, b) => deadlineOf(a) - deadlineOf(b))
  return out
}

// ── Create form ──────────────────────────────────────────────────────────────

function CreateForm({ settings, voiceChannels, textChannels, onCreated, onCancel }: {
  settings: GuildSettings | null
  voiceChannels: ChannelInfo[]
  textChannels: ChannelInfo[]
  onCreated: (p: Party) => void
  onCancel: () => void
}) {
  const toast = useToast()
  const s = settings || { defaultCap: 10, allowedGames: [] as string[] }
  const allowed = GAMES.filter(g => s.allowedGames.length === 0 || s.allowedGames.includes(g))
  const ownerPicker = useRef<UserPickerHandle>(null)

  const [name, setName] = useState('')
  const [game, setGame] = useState('Other')
  const [cap, setCap] = useState(s.defaultCap)
  const [channel, setChannel] = useState('')
  const [voice, setVoice] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const ownerId = ownerPicker.current?.getId()
    if (!ownerId) return toast('Pick an owner from the list or paste a user ID.', 'err')
    setBusy(true)
    try {
      const p = await api<Party>('/parties', {
        method: 'POST',
        body: JSON.stringify({
          ownerId,
          name,
          game,
          maxSize: Number(cap),
          channelId: channel || textChannels[0]?.id,
          voiceChannelId: voice || undefined,
          description: desc,
        }),
      })
      toast('Party created')
      onCreated(p)
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article>
      <h5>New party</h5>
      <form className="grid-2" onSubmit={e => { e.preventDefault(); if (!busy) submit() }}>
        <label>Owner<UserPicker ref={ownerPicker} placeholder="Search member by name, or paste an ID" /></label>
        <label>Name<input value={name} placeholder={'Defaults to "<owner>\'s party"'} maxLength={100} onChange={e => setName(e.target.value)} /></label>
        <label>Game
          <select value={game} onChange={e => setGame(e.target.value)}>
            {allowed.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label>Player cap<input type="number" min={2} max={50} value={cap} onChange={e => setCap(Number(e.target.value))} /></label>
        <label>Post embed in
          <select value={channel || textChannels[0]?.id || ''} onChange={e => setChannel(e.target.value)}>
            {textChannels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </select>
        </label>
        <label>Voice channel
          <select value={voice} onChange={e => setVoice(e.target.value)}>
            <option value="">— none —</option>
            {voiceChannels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
          </select>
        </label>
        <label className="span-2">Description<textarea value={desc} placeholder="Description (optional)" onChange={e => setDesc(e.target.value)} /></label>
        <div className="span-2 toolbar">
          <button type="submit" disabled={busy} aria-busy={busy}>{busy ? 'Creating…' : 'Create party'}</button>
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </article>
  )
}

// ── Party card ───────────────────────────────────────────────────────────────

type Section = 'people' | 'settings' | 'banlist'

function PartyCard({ party: p, open, onToggle, voiceChannels, onUpdate, onRemove }: {
  party: Party
  open: boolean
  onToggle: (open: boolean) => void
  voiceChannels: ChannelInfo[]
  onUpdate: (p: Party | null) => void
  onRemove: (id: string) => void
}) {
  const [section, setSection] = useState<Section>('people')
  const deadline = deadlineOf(p)
  const now = Date.now()
  const dueLabel = deadline > now ? 'in ' + relTime(deadline - now) : 'overdue'

  const status = p.isClosed ? ['closed', 'Closed']
    : p.members.length >= p.maxSize ? ['full', 'Full']
    : ['open', 'Open']

  const tabs: [Section, string][] = [
    ['people', `People (${p.members.length + p.queue.length})`],
    ['settings', 'Settings'],
    ['banlist', 'Banlist' + (p.banlist ? ` (${p.banlist.source.length})` : '')],
  ]

  return (
    <details
      className="party"
      open={open}
      onToggle={e => onToggle((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        <div className="summary-row">
          <span className={'status st-' + status[0]}><span className="dot" />{status[1]}</span>
          <span className="name">{p.name}</span>
          <span className="chip">{p.game}</span>
          <span className="chip">{p.members.length}/{p.maxSize}</span>
          {p.queue.length > 0 && <span className="chip chip-warn">{p.queue.length} queued</span>}
          <span className="grow" />
          <span className="meta" title={'Auto-disband ' + fmtAbs(deadline)}>⏱ {dueLabel}</span>
          <span className="uid">{p.id}</span>
        </div>
      </summary>
      <div className="body">
        <div className="seg">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={'seg-btn' + (id === section ? ' active' : '')}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {section === 'people' && <PeopleSection p={p} onUpdate={onUpdate} />}
        {section === 'settings' && <SettingsSection p={p} voiceChannels={voiceChannels} onUpdate={onUpdate} onRemove={onRemove} />}
        {section === 'banlist' && <BanlistSection p={p} onUpdate={onUpdate} />}
      </div>
    </details>
  )
}

function PeopleSection({ p, onUpdate }: { p: Party; onUpdate: (p: Party | null) => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const addPicker = useRef<UserPickerHandle>(null)
  const [voiceInfo, setVoiceInfo] = useState('')
  const [voiceBusy, setVoiceBusy] = useState(false)

  const call = async (fn: () => Promise<Party>, okMsg: string) => {
    try {
      onUpdate(await fn())
      toast(okMsg)
    } catch (e) { toast((e as Error).message, 'err') }
  }

  const checkVoice = async () => {
    setVoiceBusy(true)
    try {
      const v = await api<VoiceStatus>('/parties/' + p.id + '/voice')
      const nameOf = (id: string) => p.members.find(x => x.userId === id)?.displayName ?? id
      const inLinked = v.states.filter(s => v.voiceChannelId && s.channelId === v.voiceChannelId)
      const elsewhere = v.states.filter(s => s.channelId && s.channelId !== v.voiceChannelId)
      const offline = v.states.filter(s => !s.channelId)
      const parts: string[] = []
      if (v.voiceChannelId) {
        parts.push(`🔊 ${inLinked.length}/${v.states.length} in linked VC` +
          (inLinked.length ? ': ' + inLinked.map(s => nameOf(s.userId)).join(', ') : ''))
      }
      if (elsewhere.length) parts.push('elsewhere: ' + elsewhere.map(s => nameOf(s.userId)).join(', '))
      if (offline.length) parts.push('not in voice: ' + offline.map(s => nameOf(s.userId)).join(', '))
      setVoiceInfo(parts.join(' · ') || 'No members in voice.')
    } catch (e) { toast((e as Error).message, 'err') }
    setVoiceBusy(false)
  }

  return (
    <div>
      {p.members.map(m => (
        <MemberRow
          key={m.userId}
          p={p}
          m={m}
          onPromote={() => call(() => api<Party>(`/parties/${p.id}/members/${m.userId}/promote`, { method: 'POST' }), 'Promoted')}
          onRemove={() => call(() => api<Party>(`/parties/${p.id}/members/${m.userId}`, { method: 'DELETE' }), 'Removed')}
          confirmPromote={() => confirm(`Promote ${m.displayName} to owner of "${p.name}"?`, 'Promote')}
        />
      ))}
      {p.queue.length > 0 && <div className="subhead">Queue — {p.queue.length} waiting</div>}
      {p.queue.map((q, i) => (
        <QueueRow
          key={q.userId}
          p={p}
          q={q}
          idx={i}
          onMove={dir => call(() => api<Party>(`/parties/${p.id}/queue/${q.userId}/move`, {
            method: 'POST', body: JSON.stringify({ direction: dir }),
          }), 'Moved')}
          onApprove={() => call(() => api<Party>(`/parties/${p.id}/members/${q.userId}/approve`, { method: 'POST' }), 'Approved')}
          onDeny={() => call(() => api<Party>(`/parties/${p.id}/queue/${q.userId}`, { method: 'DELETE' }), 'Denied')}
        />
      ))}
      <form
        className="toolbar addbar"
        onSubmit={async e => {
          e.preventDefault()
          const userId = addPicker.current?.getId()
          if (!userId) return toast('Pick a member from the list or paste a user ID.', 'err')
          await call(() => api<Party>(`/parties/${p.id}/members`, {
            method: 'POST', body: JSON.stringify({ userId }),
          }), 'Added')
          addPicker.current?.clear()
        }}
      >
        <div className="grow">
          <UserPicker ref={addPicker} placeholder="Add a member — search by name or paste an ID" />
        </div>
        <button type="submit" className="tiny">Add</button>
      </form>
      <div className="toolbar voicebar">
        <button type="button" className="tiny ghost" aria-busy={voiceBusy} onClick={checkVoice}>Check voice</button>
        <span className="muted">{voiceInfo}</span>
      </div>
    </div>
  )
}

function MemberRow({ p, m, onPromote, onRemove, confirmPromote }: {
  p: Party
  m: PartyMember
  onPromote: () => void
  onRemove: () => void
  confirmPromote: () => Promise<boolean>
}) {
  const isOwner = m.userId === p.ownerId
  return (
    <div className="row">
      <Avatar name={m.displayName} />
      <div className="who">
        <div>
          <strong>{m.displayName}</strong>
          {isOwner && <span title="Party owner"> 👑</span>}
          {m.away && <span title="Marked as away (BRB)"> 💤</span>}
          {m.ign && <span className="muted">  {m.ign}</span>}
        </div>
        <div className="uid">{m.userId}</div>
      </div>
      <button
        className="tiny ghost"
        onClick={() => {
          sessionStorage.setItem('pb-user-lookup', m.userId)
          location.hash = '#/users'
        }}
      >
        Profile
      </button>
      {!isOwner && <button className="tiny ghost" onClick={async () => { if (await confirmPromote()) onPromote() }}>Promote</button>}
      {!isOwner ? <button className="tiny ghost-danger" onClick={onRemove}>Remove</button> : <span className="chip">owner</span>}
    </div>
  )
}

function QueueRow({ p, q, idx, onMove, onApprove, onDeny }: {
  p: Party
  q: QueueEntry
  idx: number
  onMove: (dir: 'up' | 'down') => void
  onApprove: () => void
  onDeny: () => void
}) {
  return (
    <div className="row">
      <span className="qpos">{idx + 1}</span>
      <Avatar name={q.displayName} />
      <div className="who">
        <div>
          <strong>{q.displayName}</strong>
          {q.ign && <span className="muted">  {q.ign}</span>}
        </div>
        <div className="uid">{q.userId}</div>
      </div>
      <button className="tiny ghost" title="Move up" disabled={idx === 0} onClick={() => onMove('up')}>↑</button>
      <button className="tiny ghost" title="Move down" disabled={idx === p.queue.length - 1} onClick={() => onMove('down')}>↓</button>
      <button className="tiny" onClick={onApprove}>Approve</button>
      <button className="tiny ghost-danger" onClick={onDeny}>Deny</button>
    </div>
  )
}

function SettingsSection({ p, voiceChannels, onUpdate, onRemove }: {
  p: Party
  voiceChannels: ChannelInfo[]
  onUpdate: (p: Party | null) => void
  onRemove: (id: string) => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [name, setName] = useState(p.name)
  const [cap, setCap] = useState(p.maxSize)
  const [game, setGame] = useState(p.game)
  const [voice, setVoice] = useState(p.voiceChannelId || '')
  const [desc, setDesc] = useState(p.description || '')

  const last = p.lastActivityAt ?? p.createdAt
  const deadline = deadlineOf(p)
  const now = Date.now()
  const lastLabel = last <= now ? relTime(now - last) + ' ago' : 'just now'
  const dueLabel = deadline > now ? 'in ' + relTime(deadline - now) : 'overdue'
  const unknownVoice = voice && !voiceChannels.find(c => c.id === voice)

  const act = async (fn: () => Promise<Party>, okMsg: string) => {
    try {
      onUpdate(await fn())
      toast(okMsg)
    } catch (e) { toast((e as Error).message, 'err') }
  }

  return (
    <div>
      <div className="muted activity">
        <span title={fmtAbs(last)}>Last activity: {lastLabel}</span>
        <span> · </span>
        <span title={fmtAbs(deadline)}>Auto-disband: {dueLabel}</span>
      </div>
      <form className="grid-2" onSubmit={e => e.preventDefault()}>
        <label>Name<input value={name} required maxLength={100} onChange={e => setName(e.target.value)} /></label>
        <label>Player cap<input type="number" min={2} max={50} required value={cap} onChange={e => setCap(Number(e.target.value))} /></label>
        <label>Game
          <select value={game} onChange={e => setGame(e.target.value)}>
            {GAMES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label>Voice channel
          <select value={voice} onChange={e => setVoice(e.target.value)}>
            {voiceChannels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
            {unknownVoice && <option value={voice}>(unknown: {voice})</option>}
          </select>
        </label>
        <label className="span-2">Description<textarea value={desc} onChange={e => setDesc(e.target.value)} /></label>
      </form>
      <div className="toolbar">
        <button
          type="button"
          className="tiny"
          onClick={() => act(() => api<Party>('/parties/' + p.id, {
            method: 'PATCH',
            body: JSON.stringify({ name, description: desc, maxSize: Number(cap), game, voiceChannelId: voice }),
          }), 'Saved')}
        >
          Save changes
        </button>
        <button
          type="button"
          className="tiny ghost"
          onClick={() => act(
            () => api<Party>('/parties/' + p.id + (p.isClosed ? '/open' : '/close'), { method: 'POST' }),
            p.isClosed ? 'Opened' : 'Closed',
          )}
        >
          {p.isClosed ? 'Open party' : 'Close party'}
        </button>
        <button
          type="button"
          className="tiny ghost"
          onClick={() => act(() => api<Party>('/parties/' + p.id + '/bump', {
            method: 'POST', body: JSON.stringify({}),
          }), 'Bumped')}
        >
          Bump embed
        </button>
        <span className="grow" />
        <button
          type="button"
          className="tiny ghost-danger"
          onClick={async () => {
            if (!(await confirm(`Disband "${p.name}"? Members will be released and the embed marked disbanded.`, 'Disband'))) return
            try {
              await api('/parties/' + p.id, { method: 'DELETE' })
              onRemove(p.id)
              toast('Disbanded')
            } catch (e) { toast((e as Error).message, 'err') }
          }}
        >
          Disband…
        </button>
      </div>
    </div>
  )
}

function BanlistSection({ p, onUpdate }: { p: Party; onUpdate: (p: Party | null) => void }) {
  const toast = useToast()
  const [text, setText] = useState(p.banlist?.source.join('\n') ?? '')

  const save = async (value: string) => {
    try {
      onUpdate(await api<Party>('/parties/' + p.id + '/banlist', {
        method: 'PATCH', body: JSON.stringify({ banlist: value }),
      }))
      toast(value ? 'Banlist saved' : 'Cleared')
    } catch (e) { toast((e as Error).message, 'err') }
  }

  return (
    <div>
      <p className="muted" style={{ margin: '0 0 0.4rem' }}>
        Members are assigned one ban each, in paste order. Freed bans recycle to the next joiner.
      </p>
      <textarea
        className="bans"
        placeholder="One champion per line — assigned to members in order"
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <div className="toolbar">
        <button type="button" className="tiny" onClick={() => save(text)}>Save banlist</button>
        <button type="button" className="tiny ghost" onClick={() => { setText(''); save('') }}>Clear</button>
      </div>
    </div>
  )
}
