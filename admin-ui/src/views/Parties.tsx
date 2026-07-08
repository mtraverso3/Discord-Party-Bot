import { ArrowDown, ArrowLeft, ArrowUp, ChevronRight, Crown, Moon, Plus, RefreshCw, Search, Swords, Timer, Trash2, Volume2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { GAMES } from '../games'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { Avatar } from '../components/Avatar'
import { GameList } from '../components/GameList'
import { UserPicker, type UserPickerHandle } from '../components/UserPicker'
import { ChannelSelect } from '../components/ChannelSelect'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, ErrorNote, Input, Label, Mono, Segmented, Select, Spinner, StatusDot, Switch, Textarea } from '../components/ui'
import { useGuildData } from '../lib/guildData'
import { deadlineOf, fmtAbs, relTime } from '../lib/time'
import type { ChannelInfo, GuildSettings, Party, PartyGamesResponse, PartyMember, QueueEntry, VoiceStatus } from '../types'

type SortMode = 'newest' | 'oldest' | 'fullest' | 'expiring'
type Avatars = Record<string, string | null>

const SORTS: [SortMode, string][] = [
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['fullest', 'Fullest first'],
  ['expiring', 'Expiring soonest'],
]

/** Parse the selected party id out of the hash, e.g. #/parties/<id> → "<id>". */
function selectedPartyId(): string | null {
  let h = location.hash || ''
  if (h.startsWith('#/')) h = h.slice(2)
  else if (h.startsWith('#')) h = h.slice(1)
  const parts = h.split('/')
  return parts[0] === 'parties' && parts[1] ? decodeURIComponent(parts[1]) : null
}

const goToParty = (id: string) => { location.hash = '#/parties/' + encodeURIComponent(id) }
const goToList = () => { location.hash = '#/parties' }

export function Parties() {
  const guildData = useGuildData()

  const [parties, setParties] = useState<Party[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<GuildSettings | null>(null)
  const [voiceChannels, setVoiceChannels] = useState<ChannelInfo[]>([])
  const [textChannels, setTextChannels] = useState<ChannelInfo[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(selectedPartyId)

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
    const onHash = () => setSelectedId(selectedPartyId())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

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

  if (error && !parties) return <ErrorNote>Error: {error}</ErrorNote>
  if (!parties) return <Spinner />

  if (selectedId) {
    const party = parties.find(p => p.id === selectedId)
    if (!party) {
      return (
        <div className="space-y-4">
          <Button variant="outline" size="sm" onClick={goToList}><ArrowLeft />Back to parties</Button>
          <EmptyState icon={<Swords />} title="Party not found">
            It may have been disbanded. Go back to the list to see current parties.
          </EmptyState>
        </div>
      )
    }
    return (
      <PartyDetail
        party={party}
        voiceChannels={voiceChannels}
        onUpdate={applyUpdate}
        onRemove={id => { removeLocal(id); goToList() }}
      />
    )
  }

  return (
    <PartyList
      parties={parties}
      settings={settings}
      voiceChannels={voiceChannels}
      textChannels={textChannels}
      onRefresh={refresh}
      onUpdate={applyUpdate}
      setParties={setParties}
    />
  )
}

// ── List view ─────────────────────────────────────────────────────────────────

function PartyList({ parties, settings, voiceChannels, textChannels, onRefresh, onUpdate, setParties }: {
  parties: Party[]
  settings: GuildSettings | null
  voiceChannels: ChannelInfo[]
  textChannels: ChannelInfo[]
  onRefresh: () => void
  onUpdate: (p: Party) => void
  setParties: (fn: (ps: Party[] | null) => Party[] | null) => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortMode>(() => (localStorage.getItem('pb-sort') as SortMode) || 'newest')
  const [auto, setAuto] = useState(() => localStorage.getItem('pb-autorefresh') === '1')
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    if (!auto) return
    const t = setInterval(() => {
      api<Party[]>('/parties').then(ps => setParties(() => ps)).catch(() => {})
    }, 10000)
    return () => clearInterval(t)
  }, [auto, setParties])

  const filtered = applyFilterSort(parties, query, sort)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            className="pl-8"
            placeholder="Filter by name, game, or ID"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <div className="w-44">
        <Select
          value={sort}
          onChange={e => {
            const v = e.target.value as SortMode
            setSort(v)
            localStorage.setItem('pb-sort', v)
          }}
        >
          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground" title="Refresh the list every 10 seconds">
          <Switch checked={auto} onCheckedChange={v => {
            setAuto(v)
            localStorage.setItem('pb-autorefresh', v ? '1' : '0')
          }} />
          Auto-refresh
        </label>
        <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCw />Refresh</Button>
        <Button
          variant="destructive-outline"
          size="sm"
          onClick={async () => {
            if (!(await confirm('Disband ALL parties in this guild? This cannot be undone.', 'Disband all'))) return
            try {
              await api('/clear', { method: 'POST' })
              toast('Cleared')
              onRefresh()
            } catch (e) { toast((e as Error).message, 'err') }
          }}
        >
          <Trash2 />Clear all…
        </Button>
        <Button size="sm" onClick={() => setShowCreate(s => !s)}><Plus />New party</Button>
      </div>

      {showCreate && (
        <CreateForm
          settings={settings}
          voiceChannels={voiceChannels}
          textChannels={textChannels}
          onCreated={p => { onUpdate(p); setShowCreate(false); goToParty(p.id) }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {parties.length === 0 ? (
        <EmptyState icon={<Swords />} title="No active parties">
          Create one with the “New party” button above.
        </EmptyState>
      ) : (
        <div className="space-y-2.5">
          <p className="text-xs text-muted-foreground">
            {filtered.length === parties.length
              ? `${parties.length} ${parties.length === 1 ? 'party' : 'parties'}`
              : `${filtered.length} of ${parties.length} parties`}
          </p>
          {filtered.map(p => <PartyListRow key={p.id} party={p} onOpen={() => goToParty(p.id)} />)}
        </div>
      )}
    </div>
  )
}

function PartyListRow({ party: p, onOpen }: { party: Party; onOpen: () => void }) {
  const deadline = deadlineOf(p)
  const now = Date.now()
  const dueLabel = deadline > now ? 'in ' + relTime(deadline - now) : 'overdue'
  const status = statusOf(p)

  return (
    <Card className="overflow-hidden transition-colors hover:border-primary/40">
      <button
        type="button"
        className="flex w-full cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40"
        onClick={onOpen}
      >
        <Badge variant={status.variant}><StatusDot />{status.label}</Badge>
        <span className="text-sm font-semibold">{p.name}</span>
        <Badge variant="outline">{p.game}</Badge>
        <Badge variant="secondary">{p.members.length}/{p.maxSize}</Badge>
        {p.queue.length > 0 && <Badge variant="warning">{p.queue.length} queued</Badge>}
        <span className="grow" />
        <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground" title={'Auto-disband ' + fmtAbs(deadline)}>
          <Timer className="size-3.5" />{dueLabel}
        </span>
        <Mono className="hidden sm:inline">{p.id}</Mono>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </Card>
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

function statusOf(p: Party): { variant: 'destructive' | 'warning' | 'success'; label: string } {
  return p.isClosed
    ? { variant: 'destructive', label: 'Closed' }
    : p.members.length >= p.maxSize
      ? { variant: 'warning', label: 'Full' }
      : { variant: 'success', label: 'Open' }
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
    <Card className="animate-fade-in border-primary/30">
      <CardHeader><CardTitle>New party</CardTitle></CardHeader>
      <CardContent>
        <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); if (!busy) submit() }}>
          <Label>Owner<UserPicker ref={ownerPicker} placeholder="Search member by name, or paste an ID" /></Label>
          <Label>Name<Input value={name} placeholder={'Defaults to "<owner>\'s party"'} maxLength={100} onChange={e => setName(e.target.value)} /></Label>
          <Label>Game
            <Select value={game} onChange={e => setGame(e.target.value)}>
              {allowed.map(g => <option key={g} value={g}>{g}</option>)}
            </Select>
          </Label>
          <Label>Player cap<Input type="number" min={2} max={50} value={cap} onChange={e => setCap(Number(e.target.value))} /></Label>
          <Label>Post embed in
            <ChannelSelect channels={textChannels} value={channel || textChannels[0]?.id || ''} onChange={setChannel} />
          </Label>
          <Label>Voice channel
            <ChannelSelect channels={voiceChannels} value={voice} onChange={setVoice} allowNone />
          </Label>
          <Label className="sm:col-span-2">Description<Textarea value={desc} placeholder="Description (optional)" onChange={e => setDesc(e.target.value)} /></Label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" busy={busy}>{busy ? 'Creating…' : 'Create party'}</Button>
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ── Detail page ──────────────────────────────────────────────────────────────

type Section = 'people' | 'settings' | 'banlist' | 'games'

function PartyDetail({ party: p, voiceChannels, onUpdate, onRemove }: {
  party: Party
  voiceChannels: ChannelInfo[]
  onUpdate: (p: Party | null) => void
  onRemove: (id: string) => void
}) {
  const [section, setSection] = useState<Section>('people')
  const [avatars, setAvatars] = useState<Avatars>({})

  // Resolve Discord avatars for everyone shown on this page. The endpoint is
  // 6h-cached server-side, so re-fetching as the roster changes stays cheap.
  const ids = [...p.members.map(m => m.userId), ...p.queue.map(q => q.userId)].join(',')
  useEffect(() => {
    let alive = true
    if (!ids) { setAvatars({}); return }
    api<Avatars>('/members/avatars?ids=' + encodeURIComponent(ids))
      .then(a => { if (alive) setAvatars(prev => ({ ...prev, ...a })) })
      .catch(() => {})
    return () => { alive = false }
  }, [ids])

  const deadline = deadlineOf(p)
  const now = Date.now()
  const dueLabel = deadline > now ? 'in ' + relTime(deadline - now) : 'overdue'
  const status = statusOf(p)

  const tabs: [Section, string][] = [
    ['people', `People (${p.members.length + p.queue.length})`],
    ['settings', 'Settings'],
    ['banlist', 'Banlist' + (p.banlist ? ` (${p.banlist.source.length})` : '')],
    ['games', 'Games'],
  ]

  return (
    <div className="space-y-4">
      {/*<nav className="flex items-center gap-1.5 text-sm text-muted-foreground">*/}
      {/*  <button type="button" className="cursor-pointer transition-colors hover:text-foreground" onClick={goToList}>*/}
      {/*    Parties*/}
      {/*  </button>*/}
      {/*  <ChevronRight className="size-3.5" />*/}
      {/*  <span className="font-medium text-foreground">{p.name}</span>*/}
      {/*</nav>*/}

      <Button variant="ghost" size="sm" className="-ml-2" onClick={goToList}><ArrowLeft />Back to parties</Button>

      <Card>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={status.variant}><StatusDot />{status.label}</Badge>
            <span className="text-base font-semibold">{p.name}</span>
            <Badge variant="outline">{p.game}</Badge>
            <Badge variant="secondary">{p.members.length}/{p.maxSize}</Badge>
            {p.queue.length > 0 && <Badge variant="warning">{p.queue.length} queued</Badge>}
            <span className="grow" />
            <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground" title={'Auto-disband ' + fmtAbs(deadline)}>
              <Timer className="size-3.5" />{dueLabel}
            </span>
            <Mono>{p.id}</Mono>
          </div>
          {p.description && <p className="mt-2 text-sm text-muted-foreground">{p.description}</p>}
        </CardContent>
      </Card>

      <Segmented value={section} onChange={setSection} options={tabs} />
      {section === 'people' && <PeopleSection p={p} avatars={avatars} onUpdate={onUpdate} />}
      {section === 'settings' && <SettingsSection p={p} voiceChannels={voiceChannels} onUpdate={onUpdate} onRemove={onRemove} />}
      {section === 'banlist' && <BanlistSection p={p} onUpdate={onUpdate} />}
      {section === 'games' && <GamesSection partyId={p.id} />}
    </div>
  )
}

function GamesSection({ partyId }: { partyId: string }) {
  const [data, setData] = useState<PartyGamesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api<PartyGamesResponse>('/parties/' + partyId + '/games')
      .then(d => { if (alive) setData(d) })
      .catch(e => { if (alive) setError((e as Error).message) })
    return () => { alive = false }
  }, [partyId])

  if (error) return <ErrorNote>Error: {error}</ErrorNote>
  if (!data) return <Spinner />
  return (
    <div>
      <p className="mb-3 text-xs text-muted-foreground">
        League games party members reported through the desktop client. Champions fill in once each match finishes.
      </p>
      <GameList games={data.games} />
    </div>
  )
}

function PeopleSection({ p, avatars, onUpdate }: { p: Party; avatars: Avatars; onUpdate: (p: Party | null) => void }) {
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
      <div className="divide-y rounded-lg border">
        {p.members.map(m => (
          <MemberRow
            key={m.userId}
            p={p}
            m={m}
            avatarUrl={avatars[m.userId]}
            onPromote={() => call(() => api<Party>(`/parties/${p.id}/members/${m.userId}/promote`, { method: 'POST' }), 'Promoted')}
            onRemove={() => call(() => api<Party>(`/parties/${p.id}/members/${m.userId}`, { method: 'DELETE' }), 'Removed')}
            confirmPromote={() => confirm(`Promote ${m.displayName} to owner of "${p.name}"?`, 'Promote')}
          />
        ))}
      </div>
      {p.queue.length > 0 && (
        <>
          <div className="mt-4 mb-1.5 text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">
            Queue — {p.queue.length} waiting
          </div>
          <div className="divide-y rounded-lg border">
            {p.queue.map((q, i) => (
              <QueueRow
                key={q.userId}
                p={p}
                q={q}
                idx={i}
                avatarUrl={avatars[q.userId]}
                onMove={dir => call(() => api<Party>(`/parties/${p.id}/queue/${q.userId}/move`, {
                  method: 'POST', body: JSON.stringify({ direction: dir }),
                }), 'Moved')}
                onApprove={() => call(() => api<Party>(`/parties/${p.id}/members/${q.userId}/approve`, { method: 'POST' }), 'Approved')}
                onDeny={() => call(() => api<Party>(`/parties/${p.id}/queue/${q.userId}`, { method: 'DELETE' }), 'Denied')}
              />
            ))}
          </div>
        </>
      )}
      <form
        className="mt-4 flex gap-2"
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
        <div className="flex-1">
          <UserPicker ref={addPicker} placeholder="Add a member — search by name or paste an ID" />
        </div>
        <Button type="submit" variant="secondary"><Plus />Add</Button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" busy={voiceBusy} onClick={checkVoice}><Volume2 />Check voice</Button>
        {voiceInfo && <span className="text-xs text-muted-foreground">{voiceInfo}</span>}
      </div>
    </div>
  )
}

function MemberRow({ p, m, avatarUrl, onPromote, onRemove, confirmPromote }: {
  p: Party
  m: PartyMember
  avatarUrl?: string | null
  onPromote: () => void
  onRemove: () => void
  confirmPromote: () => Promise<boolean>
}) {
  const isOwner = m.userId === p.ownerId
  return (
    <div className="flex flex-wrap items-center gap-2.5 px-3 py-2 transition-colors hover:bg-muted/40">
      <Avatar name={m.displayName} imageUrl={avatarUrl} />
      <div className="min-w-40 flex-1">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="font-medium">{m.displayName}</span>
          {isOwner && <Crown className="size-3.5 text-warning" aria-label="Party owner" />}
          {m.away && <Moon className="size-3.5 text-muted-foreground" aria-label="Marked as away (BRB)" />}
          {m.ign && <span className="text-xs text-muted-foreground">{m.ign}</span>}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>@{m.username}</span>
          <Mono>{m.userId}</Mono>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          sessionStorage.setItem('pb-user-lookup', m.userId)
          location.hash = '#/users'
        }}
      >
        Profile
      </Button>
      {!isOwner && <Button variant="outline" size="sm" onClick={async () => { if (await confirmPromote()) onPromote() }}>Promote</Button>}
      {!isOwner
        ? <Button variant="destructive-outline" size="sm" onClick={onRemove}>Remove</Button>
        : <Badge variant="warning"><Crown className="size-3" />owner</Badge>}
    </div>
  )
}

function QueueRow({ p, q, idx, avatarUrl, onMove, onApprove, onDeny }: {
  p: Party
  q: QueueEntry
  idx: number
  avatarUrl?: string | null
  onMove: (dir: 'up' | 'down') => void
  onApprove: () => void
  onDeny: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 px-3 py-2 transition-colors hover:bg-muted/40">
      <span className="w-4 shrink-0 text-right font-mono text-xs text-muted-foreground">{idx + 1}</span>
      <Avatar name={q.displayName} imageUrl={avatarUrl} />
      <div className="min-w-40 flex-1">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="font-medium">{q.displayName}</span>
          {q.ign && <span className="text-xs text-muted-foreground">{q.ign}</span>}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>@{q.username}</span>
          <Mono>{q.userId}</Mono>
        </div>
      </div>
      <Button variant="ghost" size="icon" className="size-8" title="Move up" disabled={idx === 0} onClick={() => onMove('up')}><ArrowUp /></Button>
      <Button variant="ghost" size="icon" className="size-8" title="Move down" disabled={idx === p.queue.length - 1} onClick={() => onMove('down')}><ArrowDown /></Button>
      <Button variant="secondary" size="sm" onClick={onApprove}>Approve</Button>
      <Button variant="destructive-outline" size="sm" onClick={onDeny}>Deny</Button>
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

  const act = async (fn: () => Promise<Party>, okMsg: string) => {
    try {
      onUpdate(await fn())
      toast(okMsg)
    } catch (e) { toast((e as Error).message, 'err') }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span title={fmtAbs(last)}>Last activity: <span className="font-medium text-foreground">{lastLabel}</span></span>
        <span title={fmtAbs(deadline)}>Auto-disband: <span className="font-medium text-foreground">{dueLabel}</span></span>
      </div>
      <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={e => e.preventDefault()}>
        <Label>Name<Input value={name} required maxLength={100} onChange={e => setName(e.target.value)} /></Label>
        <Label>Player cap<Input type="number" min={2} max={50} required value={cap} onChange={e => setCap(Number(e.target.value))} /></Label>
        <Label>Game
          <Select value={game} onChange={e => setGame(e.target.value)}>
            {GAMES.map(g => <option key={g} value={g}>{g}</option>)}
          </Select>
        </Label>
        <Label>Voice channel
          <ChannelSelect channels={voiceChannels} value={voice} onChange={setVoice} allowNone />
        </Label>
        <Label className="sm:col-span-2">Description<Textarea value={desc} onChange={e => setDesc(e.target.value)} /></Label>
      </form>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => act(() => api<Party>('/parties/' + p.id, {
            method: 'PATCH',
            body: JSON.stringify({ name, description: desc, maxSize: Number(cap), game, voiceChannelId: voice }),
          }), 'Saved')}
        >
          Save changes
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => act(
            () => api<Party>('/parties/' + p.id + (p.isClosed ? '/open' : '/close'), { method: 'POST' }),
            p.isClosed ? 'Opened' : 'Closed',
          )}
        >
          {p.isClosed ? 'Open party' : 'Close party'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => act(() => api<Party>('/parties/' + p.id + '/bump', {
            method: 'POST', body: JSON.stringify({}),
          }), 'Bumped')}
        >
          Bump embed
        </Button>
        <span className="grow" />
        <Button
          variant="destructive-outline"
          size="sm"
          onClick={async () => {
            if (!(await confirm(`Disband "${p.name}"? Members will be released and the embed marked disbanded.`, 'Disband'))) return
            try {
              await api('/parties/' + p.id, { method: 'DELETE' })
              onRemove(p.id)
              toast('Disbanded')
            } catch (e) { toast((e as Error).message, 'err') }
          }}
        >
          <Trash2 />Disband…
        </Button>
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
      <p className="mb-2 text-xs text-muted-foreground">
        Members are assigned one ban each, in paste order. Freed bans recycle to the next joiner.
      </p>
      <Textarea
        className="min-h-28 font-mono text-xs"
        placeholder="One champion per line — assigned to members in order"
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => save(text)}>Save banlist</Button>
        <Button variant="outline" size="sm" onClick={() => { setText(''); save('') }}>Clear</Button>
      </div>
    </div>
  )
}
