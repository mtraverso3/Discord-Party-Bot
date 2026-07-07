import type { PartyBotBridge } from '../preload'
import type {
  AutoJoinSettings, LcuStatus, LinkState, LobbyMode, LobbyView, Session, SessionResult, TaggedPlayer,
} from '../shared/types'
import { LOBBY_MODES } from '../shared/types'

declare global {
  interface Window { pb: PartyBotBridge }
}
const pb = window.pb

// ── Tiny DOM helper ───────────────────────────────────────────────────────────

type Kid = Node | string | number | null | false | undefined | Kid[]

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, unknown> = {}, ...kids: Kid[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v as EventListener)
    else if (k === 'class') e.className = String(v)
    else e.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of kids.flat(Infinity as 1)) {
    if (c == null || c === false) continue
    e.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : (c as Node))
  }
  return e
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
function toast(message: string, kind: 'ok' | 'err' = 'ok'): void {
  let t = document.getElementById('toast')
  if (!t) { t = el('div', { id: 'toast' }); document.body.append(t) }
  t.textContent = message
  t.className = `show${kind === 'err' ? ' err' : ''}`
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t!.className = '' }, 3500)
}

// ── App state ─────────────────────────────────────────────────────────────────

let lcu: LcuStatus = { connected: false, summoner: null }
let link: LinkState = { linked: false, botUrl: '' }
let session: Session | null = null
let sessionError: string | null = null
let lobby: LobbyView = { exists: false, rows: [], missing: [], intruders: 0 }
let inviteBusy = false
let selectedMode: LobbyMode = 'custom-draft'
let autoJoin: AutoJoinSettings = { enabled: false, targetName: '', inviteParty: false }
let autoJoinOpen = false // not part of viewKey — re-renders shouldn't force it closed
let tagged: TaggedPlayer[] = []
let settingsOpen = false
let newTagRiotId = '' // transient "add tag" form fields — not part of viewKey, so a
let newTagLabel = ''  // background poll re-render can't wipe an in-progress entry

const root = document.getElementById('app')!
let lastKey = ''

function screen(): 'link' | 'no-party' | 'party' {
  if (!link.linked) return 'link'
  if (!session?.party) return 'no-party'
  return 'party'
}

// Re-render only when the data that drives the current screen changes, so the
// link-code input never loses focus while polling.
function viewKey(): string {
  return JSON.stringify([screen(), lcu, session, sessionError, lobby, inviteBusy, autoJoin, settingsOpen, tagged])
}

function render(force = false): void {
  const key = viewKey()
  if (!force && key === lastKey) return
  lastKey = key

  const main = settingsOpen ? renderSettings()
    : screen() === 'link' ? renderLink()
    : screen() === 'no-party' ? renderNoParty()
    : renderParty()

  root.replaceChildren(
    renderHeader(),
    ...(settingsOpen ? [] : [renderAutoJoinCard()]),
    ...main,
    renderFooter(),
  )
}

// ── Lobby-only tags (exclude known people from the "not in party" alert) ─────
// Accessible from Settings at any time, and edited inline whenever someone
// shows up in a live lobby — both paths go through the same setter.

function normalizeRiotId(riotId: string): string {
  return riotId.toLowerCase().replace(/\s+/g, ' ').trim()
}

function setTagFor(riotId: string, tagText: string): void {
  const trimmed = tagText.trim()
  const rest = tagged.filter(t => normalizeRiotId(t.riotId) !== normalizeRiotId(riotId))
  tagged = trimmed ? [...rest, { riotId, tag: trimmed }] : rest
  void pb.tagsSet(tagged)
  render(true)
  void refreshLobby() // reflect the new status in the live lobby view too
}

function renderSettings(): HTMLElement[] {
  const riotIdInput = el('input', {
    type: 'text', class: 'plain-input', placeholder: 'Riot ID (e.g. Faker#KR1)', value: newTagRiotId,
    oninput: (e: Event) => { newTagRiotId = (e.target as HTMLInputElement).value },
  })
  const labelInput = el('input', {
    type: 'text', class: 'plain-input', placeholder: 'Label (e.g. coach, friend)', value: newTagLabel,
    oninput: (e: Event) => { newTagLabel = (e.target as HTMLInputElement).value },
  })
  const addBtn = el('button', {
    class: 'block',
    onclick: () => {
      const riotId = newTagRiotId.trim()
      const label = newTagLabel.trim()
      if (!riotId || !label) { toast('Enter a Riot ID and a label', 'err'); return }
      newTagRiotId = ''
      newTagLabel = ''
      setTagFor(riotId, label)
    },
  }, 'Add')

  const rows = tagged.length > 0
    ? tagged.map(t => el('div', { class: 'item' },
        el('span', { class: 'name' }, t.riotId, el('span', { class: 'ign' }, t.tag)),
        el('button', { class: 'linklike', onclick: () => setTagFor(t.riotId, '') }, 'Remove'),
      ))
    : [el('p', { class: 'muted small' }, 'No tagged players yet.')]

  return [el('div', { class: 'card' },
    el('h2', {}, 'Lobby tags'),
    el('p', { class: 'sub' },
      'Give lobby-only players you recognize a label of your own choosing. They\'ll still ' +
      'show up in the lobby list, just excluded from the "not in party" alert.'),
    el('div', { class: 'row', style: 'margin-bottom:8px' }, riotIdInput),
    el('div', { class: 'row', style: 'margin-bottom:12px' }, labelInput),
    el('div', { style: 'margin-bottom:12px' }, addBtn),
    el('div', { class: 'list' }, rows),
  )]
}

// ── Auto-join friend's lobby ──────────────────────────────────────────────────

function renderAutoJoinCard(): HTMLElement {
  const nameInput = el('input', {
    type: 'text', placeholder: 'Friend Riot ID or name', value: autoJoin.targetName,
    onchange: (e: Event) => {
      autoJoin = { ...autoJoin, targetName: (e.target as HTMLInputElement).value }
      void pb.autoJoinSet(autoJoin)
    },
  })
  const enabledToggle = el('input', {
    type: 'checkbox', checked: autoJoin.enabled,
    onchange: (e: Event) => {
      autoJoin = { ...autoJoin, enabled: (e.target as HTMLInputElement).checked }
      void pb.autoJoinSet(autoJoin)
    },
  })
  const invitePartyToggle = el('input', {
    type: 'checkbox', checked: autoJoin.inviteParty,
    onchange: (e: Event) => {
      autoJoin = { ...autoJoin, inviteParty: (e.target as HTMLInputElement).checked }
      void pb.autoJoinSet(autoJoin)
    },
  })

  return el('details', {
    class: 'card', open: autoJoinOpen,
    ontoggle: (e: Event) => { autoJoinOpen = (e.target as HTMLDetailsElement).open },
  },
    el('summary', {}, "Auto-join friend's lobby"),
    el('div', { class: 'row', style: 'margin-top:10px' }, el('label', {}, enabledToggle, ' Enabled'), nameInput),
    el('div', { class: 'row', style: 'margin-top:8px' },
      el('label', {}, invitePartyToggle, ' Invite my party after joining')),
  )
}

// ── Header / footer ───────────────────────────────────────────────────────────

function renderHeader(): HTMLElement {
  const leaguePill = el('span', { class: `pill ${lcu.connected ? 'on' : 'off'}` },
    el('span', { class: 'dot' }),
    lcu.connected
      ? (lcu.summoner ? `${lcu.summoner.gameName}#${lcu.summoner.tagLine}` : 'League')
      : 'League offline',
  )
  const discordPill = el('span', { class: `pill ${link.linked ? 'on' : 'off'}` },
    el('span', { class: 'dot' }),
    link.linked ? (link.displayName ?? 'Linked') : 'Not linked',
  )
  const settingsBtn = el('button', {
    class: 'iconbtn', title: settingsOpen ? 'Back' : 'Settings',
    onclick: () => { settingsOpen = !settingsOpen; render(true) },
  }, settingsOpen ? '← Back' : '⚙ Settings')
  return el('header', {}, el('h1', {}, 'PartyBot'), leaguePill, discordPill, settingsBtn)
}

function renderFooter(): HTMLElement {
  return el('footer', {},
    el('span', {}, link.botUrl.replace(/^https?:\/\//, '')),
    link.linked
      ? el('button', { class: 'linklike', onclick: async () => {
          await pb.unlink()
          link = await pb.linkState()
          session = null
          render(true)
        } }, 'Unlink account')
      : el('span', {}),
  )
}

// ── Screens ───────────────────────────────────────────────────────────────────

function renderLink(): HTMLElement[] {
  const input = el('input', {
    type: 'text', placeholder: 'LINK CODE', maxlength: 8,
    autofocus: true, spellcheck: 'false',
  })
  const error = el('div', { class: 'error' })
  const btn = el('button', { class: 'block', onclick: submit }, 'Link account')

  async function submit(): Promise<void> {
    const code = input.value.trim().toUpperCase()
    if (code.length !== 8) { error.textContent = 'The code is 8 characters.'; return }
    btn.toggleAttribute('disabled', true)
    error.textContent = ''
    const res = await pb.linkAuth(code)
    btn.toggleAttribute('disabled', false)
    if (!res.ok) { error.textContent = res.error ?? 'Linking failed.'; return }
    link = await pb.linkState()
    toast(`Linked as ${res.displayName ?? 'you'}`)
    void refreshSession()
    render(true)
  }
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') void submit() })

  return [el('div', { class: 'card center-card' },
    el('div', { class: 'big' }, 'Link your Discord account'),
    el('p', { class: 'sub' }, 'Run ', el('b', {}, '/party link'), ' in Discord, then enter the code below. You only do this once.'),
    input,
    el('div', { style: 'height:10px' }),
    btn,
    error,
  )]
}

function renderNoParty(): HTMLElement[] {
  return [el('div', { class: 'card center-card' },
    el('div', { class: 'big' }, sessionError ? 'Connection problem' : 'No active party'),
    el('p', { class: 'sub' },
      sessionError ?? 'Join or create a party in Discord and it will show up here.'),
  )]
}

function renderParty(): HTMLElement[] {
  const p = session!.party!
  const out: HTMLElement[] = []

  // Roster card.
  const inLobbyNames = new Set(
    lobby.rows.filter(r => r.status === 'party').map(r => r.displayName),
  )
  const memberRow = (m: { displayName: string; ign: string | null; isOwner: boolean; userId: string }) => {
    const isSelf = m.userId === session!.userId
    let badge: HTMLElement
    if (!lobby.exists) {
      badge = m.ign
        ? el('span', { class: 'badge mut' }, 'ready')
        : el('span', { class: 'badge warn' }, 'no IGN')
    } else if (isSelf || inLobbyNames.has(m.displayName)) {
      badge = el('span', { class: 'badge ok' }, 'in lobby')
    } else if (!m.ign) {
      badge = el('span', { class: 'badge warn' }, 'no IGN')
    } else {
      badge = el('span', { class: 'badge mut' }, 'waiting')
    }
    return el('div', { class: 'item' },
      el('span', { class: 'name' },
        m.displayName + (m.isOwner ? ' 👑' : '') + (isSelf ? ' (you)' : ''),
        el('span', { class: 'ign' }, m.ign ?? 'No IGN set: /party ign in Discord'),
      ),
      badge,
    )
  }

  out.push(el('div', { class: 'card' },
    el('div', { class: 'row', style: 'margin-bottom:4px' },
      el('h2', { class: 'grow' }, p.name),
      el('span', { class: 'chip' }, p.game),
      el('span', { class: 'chip' }, `${p.members.length}/${p.maxSize}`),
    ),
    el('div', { class: 'list' }, p.members.map(memberRow)),
  ))

  // Invite controls.
  if (session!.canInvite) {
    const select = el('select', {
      class: 'grow',
      onchange: (e: Event) => { selectedMode = (e.target as HTMLSelectElement).value as LobbyMode },
    }, LOBBY_MODES.map(m => el('option', { value: m.value, selected: m.value === selectedMode }, m.label)))

    const inviteBtn = el('button', {
      // Full-width when it's alone in the row (no mode picker needed).
      class: lobby.exists ? 'block' : null,
      disabled: !lcu.connected || inviteBusy,
      onclick: async () => {
        inviteBusy = true
        render(true)
        const res = await pb.createLobbyAndInvite(selectedMode)
        inviteBusy = false
        if (!res.ok) {
          toast(res.error ?? 'Invite failed', 'err')
        } else {
          const sent = res.outcomes.filter(o => o.status === 'invited').length
          const skipped = res.outcomes.filter(o => o.status === 'no-ign' || o.status === 'not-found')
          toast(`${res.createdNew ? 'Lobby created' : 'Invited to your lobby'}, ${sent} invite${sent === 1 ? '' : 's'} sent` +
            (skipped.length ? `, ${skipped.length} skipped (no/invalid IGN)` : ''))
        }
        void refreshLobby()
        render(true)
      },
    }, inviteBusy ? 'Inviting…' : (lobby.exists ? 'Invite all to this lobby' : 'Create lobby & invite all'))

    out.push(el('div', { class: 'card' },
      el('h2', {}, 'League lobby'),
      el('p', { class: 'sub' },
        !lcu.connected ? 'Start the League client to create a lobby.'
        : lobby.exists ? 'Invites every member into the lobby you are in now.'
        : 'Creates the lobby on your client and invites every member by their IGN.'),
      // The mode picker only matters when a lobby has to be created.
      el('div', { class: 'row' }, lobby.exists ? null : select, inviteBtn),
    ))
  }

  // Live lobby cross-reference.
  if (lobby.exists) {
    const rows = lobby.rows.map((r) => {
      const nameEl = el('span', { class: 'name' },
        r.riotId + (r.isLeader ? ' 👑' : ''),
        r.displayName ? el('span', { class: 'ign' }, r.displayName) : null,
      )
      const badge =
        r.status === 'you' ? el('span', { class: 'badge mut' }, 'you')
        : r.status === 'party' ? el('span', { class: 'badge ok' }, 'party')
        : r.status === 'tagged' ? el('span', { class: 'badge warn' }, r.tag)
        : el('span', { class: 'badge bad' }, 'NOT IN PARTY')

      return el('div', { class: 'item' }, nameEl, badge)
    })

    out.push(el('div', { class: 'card' },
      el('h2', {}, 'In lobby'),
      lobby.intruders > 0
        ? el('div', { class: 'alert bad', style: 'margin-bottom:8px' },
            `⚠ ${lobby.intruders} player${lobby.intruders === 1 ? '' : 's'} in the lobby ${lobby.intruders === 1 ? 'is' : 'are'} not in the party.`)
        : null,
      el('div', { class: 'list' }, rows),
      lobby.missing.length > 0
        ? el('p', { class: 'muted small', style: 'margin:10px 0 0' },
            'Not in lobby yet: ' + lobby.missing.map(m => m.displayName).join(', '))
        : null,
    ))
  }

  return out
}

// ── Polling ───────────────────────────────────────────────────────────────────

async function refreshLcu(): Promise<void> {
  lcu = await pb.lcuStatus()
  render()
}

async function refreshSession(): Promise<void> {
  if (!link.linked) return
  const res: SessionResult = await pb.session()
  if (res.ok) {
    session = res.session as Session
    sessionError = null
  } else if (res.authExpired) {
    link = await pb.linkState()
    session = null
    sessionError = null
    toast('Your link expired, link again with /party link', 'err')
  } else {
    sessionError = res.error ?? 'PartyBot is unreachable.'
  }
  render()
}

async function refreshLobby(): Promise<void> {
  lobby = (link.linked && session?.party && lcu.connected)
    ? await pb.lobbyStatus()
    : { exists: false, rows: [], missing: [], intruders: 0 }
  render()
}

async function refreshAutoJoin(): Promise<void> {
  autoJoin = await pb.autoJoinGet()
  render()
}

async function refreshTagged(): Promise<void> {
  tagged = await pb.tagsGet()
}

async function start(): Promise<void> {
  link = await pb.linkState()
  await refreshLcu()
  await refreshSession()
  await refreshTagged()
  await refreshLobby()
  await refreshAutoJoin()
  render(true)
  setInterval(() => { void refreshLcu() }, 3000)
  setInterval(() => { void refreshSession() }, 5000)
  setInterval(() => { void refreshLobby() }, 3000)
  setInterval(() => { void refreshAutoJoin() }, 5000)
}

void start()
