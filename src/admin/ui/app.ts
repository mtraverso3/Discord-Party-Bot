/**
 * Client-side JS for the admin UI, injected into a <script> tag by html.ts.
 *
 * IMPORTANT: this string is embedded in a TS template literal, so the client
 * code must not contain backticks or dollar-brace sequences, and any
 * backslash must be doubled (which is why the code avoids regex literals and
 * string escapes entirely).
 */

export const ADMIN_APP_JS = `
// ── Boot & helpers ───────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search)
const guildId = params.get('guild')
const $ = (sel, root = document) => root.querySelector(sel)
const subtitle = $('#subtitle')
const content  = $('#content')
const toastEl  = $('#toast')

function applyTheme(t) {
  document.documentElement.dataset.theme = t
  $('#theme-btn').textContent = t === 'dark' ? '☀' : '🌙'
}
$('#theme-btn').addEventListener('click', () => {
  const next = (localStorage.getItem('pb-theme') || 'light') === 'dark' ? 'light' : 'dark'
  localStorage.setItem('pb-theme', next)
  applyTheme(next)
})
applyTheme(localStorage.getItem('pb-theme') || 'light')

let toastTimer
function toast(msg, kind = 'ok') {
  toastEl.textContent = msg
  toastEl.classList.toggle('err', kind === 'err')
  toastEl.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastEl.hidden = true }, kind === 'err' ? 5000 : 2500)
}

async function api(path, opts = {}) {
  const sep = path.includes('?') ? '&' : '?'
  const url = '/admin/api' + path + (guildId ? sep + 'guild=' + encodeURIComponent(guildId) : '')
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  const ct = res.headers.get('content-type') || ''
  if (!res.ok) {
    const err = ct.includes('json') ? await res.json().catch(() => ({})) : {}
    throw new Error(err.error || res.statusText || 'request failed')
  }
  return ct.includes('json') ? res.json() : null
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else if (k === 'class') e.className = v
    else if (k === 'value') e.value = v
    else e.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue
    e.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(c) : c)
  }
  return e
}

const HOUR_MS = 60 * 60 * 1000
function inactivityMs(p) {
  if (p.members.length >= p.maxSize || p.queue.length > 0) return 12 * HOUR_MS
  if (p.members.length > 1) return 6 * HOUR_MS
  return 2 * HOUR_MS
}
function deadlineOf(p) { return (p.lastActivityAt ?? p.createdAt) + inactivityMs(p) }
function relTime(ms) {
  const abs = Math.abs(ms)
  const m = Math.round(abs / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return m + ' min'
  const h = Math.floor(m / 60), mm = m % 60
  if (h < 24) return mm ? h + 'h ' + mm + 'm' : h + 'h'
  const d = Math.floor(h / 24), hh = h % 24
  return hh ? d + 'd ' + hh + 'h' : d + 'd'
}
function fmtAbs(ts) {
  const d = new Date(ts)
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

// ── State ────────────────────────────────────────────────────────────────────
let guilds = null
let settings = null
let voiceChannels = null
let textChannels = null
let lastParties = []
let autoTimer = null
let searchQuery = ''
let sortMode = localStorage.getItem('pb-sort') || 'newest'

async function getSettings(force) {
  if (!settings || force) settings = await api('/settings')
  return settings
}
async function getVoiceChannels() {
  if (!voiceChannels) voiceChannels = await api('/channels')
  return voiceChannels
}
async function getTextChannels() {
  if (!textChannels) textChannels = await api('/channels?kind=text')
  return textChannels
}

// ── Tabs & routing ───────────────────────────────────────────────────────────
const TABS = [
  ['dashboard', 'Dashboard'],
  ['parties', 'Parties'],
  ['users', 'Users'],
  ['audit', 'Audit log'],
  ['settings', 'Settings'],
]
function currentTab() {
  let h = location.hash || ''
  if (h.startsWith('#/')) h = h.slice(2)
  else if (h.startsWith('#')) h = h.slice(1)
  return TABS.some(t => t[0] === h) ? h : 'dashboard'
}

function renderTabsNav() {
  const active = currentTab()
  $('#tabs').replaceChildren(...TABS.map(([id, label]) =>
    el('a', { href: '#/' + id, class: id === active ? 'active' : '' }, label)))
}

function stopAutoRefresh() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null }
}

async function renderTab() {
  stopAutoRefresh()
  renderTabsNav()
  const view = $('#view')
  view.replaceChildren(el('progress'))
  const tab = currentTab()
  try {
    if (tab === 'dashboard')     await viewDashboard(view)
    else if (tab === 'parties')  await viewParties(view)
    else if (tab === 'users')    await viewUsers(view)
    else if (tab === 'audit')    await viewAudit(view)
    else if (tab === 'settings') await viewSettings(view)
  } catch (e) {
    view.replaceChildren(el('article', {}, 'Error: ' + e.message))
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
api('/me').then(r => { if (r && r.email) $('#who').textContent = r.email }).catch(() => {})

if (!guildId) {
  showGuildPicker()
} else {
  localStorage.setItem('pb-guild', guildId)
  subtitle.textContent = 'Guild: ' + guildId
  $('#change-guild').style.display = ''
  content.replaceChildren(el('nav', { id: 'tabs', class: 'tabs' }), el('div', { id: 'view' }))
  window.addEventListener('hashchange', renderTab)
  renderTab()
  api('/guilds').then(gs => {
    guilds = gs
    const g = gs.find(x => x.id === guildId)
    if (g) subtitle.textContent = g.name
  }).catch(() => {})
}

// ── Guild picker ─────────────────────────────────────────────────────────────
async function showGuildPicker() {
  subtitle.textContent = 'Pick a server to manage'
  content.replaceChildren(el('progress'))
  let gs = []
  try { gs = await api('/guilds') } catch (e) { /* fall back to manual entry */ }

  const last = localStorage.getItem('pb-guild')
  const sorted = gs.slice().sort((a, b) => (b.id === last) - (a.id === last))
  const nodes = []
  if (sorted.length > 0) {
    nodes.push(el('div', { class: 'guild-grid' }, sorted.map(g => guildCard(g, g.id === last))))
  } else {
    nodes.push(el('p', { class: 'muted' }, 'Could not list servers — enter a guild ID manually:'))
  }
  nodes.push(manualGuildForm())
  content.replaceChildren(...nodes)
}

function guildCard(g, isLast) {
  const icon = g.icon
    ? el('img', { class: 'gicon', src: 'https://cdn.discordapp.com/icons/' + g.id + '/' + g.icon + '.png?size=64', alt: '' })
    : el('div', { class: 'gicon ginit' }, (g.name || '?').slice(0, 1).toUpperCase())
  return el('a', { class: 'gcard', href: '?guild=' + encodeURIComponent(g.id) + '#/dashboard' },
    icon,
    el('div', {},
      el('div', { class: 'gname' }, g.name),
      el('div', { class: 'uid' }, g.id + (isLast ? ' · last used' : '')),
    ),
  )
}

function manualGuildForm() {
  const input = el('input', { type: 'text', name: 'guild', placeholder: 'Guild ID', autocomplete: 'off' })
  const form = el('form', { class: 'toolbar' },
    el('div', { class: 'grow' }, input),
    el('button', { type: 'submit', class: 'secondary' }, 'Open'),
  )
  form.addEventListener('submit', e => {
    e.preventDefault()
    const id = input.value.trim()
    if (id) location.href = '?guild=' + encodeURIComponent(id) + '#/dashboard'
  })
  return el('details', {},
    el('summary', { class: 'muted' }, 'Enter a guild ID manually'),
    form,
  )
}

// ── Dashboard ────────────────────────────────────────────────────────────────
async function viewDashboard(view) {
  const [parties, s] = await Promise.all([api('/parties'), getSettings(true)])
  lastParties = parties

  const members = parties.reduce((a, p) => a + p.members.length, 0)
  const queued = parties.reduce((a, p) => a + p.queue.length, 0)
  const open = parties.filter(p => !p.isClosed && p.members.length < p.maxSize).length
  const full = parties.filter(p => !p.isClosed && p.members.length >= p.maxSize).length
  const closed = parties.filter(p => p.isClosed).length

  const stat = (num, lbl) => el('div', { class: 'stat' },
    el('div', { class: 'num' }, String(num)), el('div', { class: 'lbl' }, lbl))

  const stats = el('div', { class: 'stat-grid' },
    stat(parties.length + ' / ' + s.maxParties, 'Active parties'),
    stat(members, 'Players in parties'),
    stat(queued, 'Waiting in queues'),
    stat(open + ' · ' + full + ' · ' + closed, 'Open · Full · Closed'),
  )

  if (parties.length === 0) {
    view.replaceChildren(stats, el('div', { class: 'empty' },
      'No active parties. ', el('a', { href: '#/parties' }, 'Create one'), ' from the Parties tab.'))
    return
  }

  const byGame = new Map()
  for (const p of parties) {
    const g = byGame.get(p.game) || { parties: 0, members: 0 }
    g.parties++; g.members += p.members.length
    byGame.set(p.game, g)
  }
  const gameTable = el('table', { class: 'compact' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Game'), el('th', {}, 'Parties'), el('th', {}, 'Players'))),
    el('tbody', {}, [...byGame.entries()].map(([g, n]) =>
      el('tr', {}, el('td', {}, g), el('td', {}, String(n.parties)), el('td', {}, String(n.members))))),
  )

  const now = Date.now()
  const soon = parties
    .map(p => ({ p, deadline: deadlineOf(p) }))
    .sort((a, b) => a.deadline - b.deadline)
    .slice(0, 5)
  const soonList = el('div', {}, soon.map(({ p, deadline }) =>
    el('div', { class: 'row' },
      el('div', { class: 'who' },
        el('strong', {}, p.name), ' ',
        el('span', { class: 'uid' }, p.id)),
      el('span', { class: 'muted', title: fmtAbs(deadline) },
        deadline > now ? '⏱ in ' + relTime(deadline - now) : '⏱ overdue'),
    )))

  view.replaceChildren(
    stats,
    el('div', { class: 'grid-2col' },
      el('article', {}, el('h5', {}, 'By game'), gameTable),
      el('article', {}, el('h5', {}, 'Next auto-disbands'), soonList),
    ),
  )
}

// ── Parties tab ──────────────────────────────────────────────────────────────
async function viewParties(view) {
  const [parties] = await Promise.all([api('/parties'), getSettings(), getVoiceChannels(), getTextChannels()])
  lastParties = parties

  const search = el('input', {
    type: 'search', placeholder: 'Filter by name, game, or ID', value: searchQuery,
    oninput: e => { searchQuery = e.target.value; renderPartyList() },
  })
  const sortSel = el('select', { onchange: e => {
    sortMode = e.target.value
    localStorage.setItem('pb-sort', sortMode)
    renderPartyList()
  } }, ...[['newest', 'Newest first'], ['oldest', 'Oldest first'], ['fullest', 'Fullest first'], ['expiring', 'Expiring soonest']]
    .map(([v, l]) => el('option', { value: v, selected: v === sortMode ? 'selected' : null }, l)))

  const autoBox = el('input', { type: 'checkbox', role: 'switch',
    checked: localStorage.getItem('pb-autorefresh') === '1' ? 'checked' : null,
    onchange: e => {
      localStorage.setItem('pb-autorefresh', e.target.checked ? '1' : '0')
      if (e.target.checked) startAutoRefresh(); else stopAutoRefresh()
    } })

  const createBox = el('div', { id: 'create-box' })
  const toolbar = el('div', { class: 'toolbar' },
    el('div', { class: 'grow' }, search),
    sortSel,
    el('label', { style: 'display:flex;align-items:center;gap:0.3rem' }, autoBox, 'Auto'),
    el('button', { class: 'secondary tiny', onclick: refreshParties }, 'Refresh'),
    el('button', { class: 'tiny', onclick: () => toggleCreateForm(createBox) }, 'New party'),
    el('button', { class: 'danger tiny', onclick: async () => {
      if (!confirm('Disband ALL parties in this guild? This cannot be undone.')) return
      try { await api('/clear', { method: 'POST' }); toast('Cleared'); refreshParties() }
      catch (e) { toast(e.message, 'err') }
    } }, 'Clear all'),
  )

  view.replaceChildren(toolbar, createBox, el('div', { id: 'plist' }))
  renderPartyList()
  if (localStorage.getItem('pb-autorefresh') === '1') startAutoRefresh()
}

async function refreshParties() {
  try {
    lastParties = await api('/parties')
    renderPartyList()
  } catch (e) { toast(e.message, 'err') }
}

function startAutoRefresh() {
  stopAutoRefresh()
  autoTimer = setInterval(() => {
    if (currentTab() !== 'parties') return stopAutoRefresh()
    api('/parties').then(ps => { lastParties = ps; renderPartyList() }).catch(() => {})
  }, 10000)
}

function applyFilterSort(parties) {
  let out = parties.slice()
  const q = searchQuery.trim().toLowerCase()
  if (q) {
    out = out.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.game.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q))
  }
  if (sortMode === 'newest') out.sort((a, b) => b.createdAt - a.createdAt)
  else if (sortMode === 'oldest') out.sort((a, b) => a.createdAt - b.createdAt)
  else if (sortMode === 'fullest') out.sort((a, b) => (b.members.length / b.maxSize) - (a.members.length / a.maxSize))
  else if (sortMode === 'expiring') out.sort((a, b) => deadlineOf(a) - deadlineOf(b))
  return out
}

function renderPartyList() {
  const list = $('#plist')
  if (!list) return
  if (lastParties.length === 0) {
    list.replaceChildren(el('div', { class: 'empty' }, 'No active parties.'))
    return
  }
  const openIds = new Set(
    [...list.querySelectorAll('details.party[open]')].map(d => d.dataset.partyId).filter(Boolean))
  const ps = applyFilterSort(lastParties)
  const counter = el('p', { class: 'muted', style: 'margin:0.25rem 0' },
    ps.length === lastParties.length
      ? lastParties.length + ' part' + (lastParties.length === 1 ? 'y' : 'ies')
      : ps.length + ' of ' + lastParties.length + ' parties')
  list.replaceChildren(counter, ...ps.map(p => renderParty(p, openIds.has(p.id))))
}

function toggleCreateForm(box) {
  if (box.childElementCount > 0) { box.replaceChildren(); return }
  const s = settings || { defaultCap: 10, allowedGames: [] }
  const allowed = GAMES.filter(g => s.allowedGames.length === 0 || s.allowedGames.includes(g))

  const f = {
    owner: el('input', { name: 'ownerId', placeholder: 'Discord user ID of the owner', required: true }),
    name: el('input', { name: 'name', placeholder: 'Defaults to "<owner>\\'s party"', maxlength: 100 }),
    game: el('select', { name: 'game' }, ...allowed.map(g =>
      el('option', { value: g, selected: g === 'Other' ? 'selected' : null }, g))),
    cap: el('input', { type: 'number', name: 'cap', value: s.defaultCap, min: 2, max: 50 }),
    channel: el('select', { name: 'channel' }, ...(textChannels || []).map(c =>
      el('option', { value: c.id }, '#' + c.name))),
    voice: el('select', { name: 'voice' },
      el('option', { value: '' }, '— none —'),
      ...(voiceChannels || []).map(c => el('option', { value: c.id }, '#' + c.name))),
    desc: el('textarea', { name: 'description', placeholder: 'Description (optional)' }),
  }

  const form = el('form', { class: 'grid-2' },
    el('label', {}, 'Owner', f.owner),
    el('label', {}, 'Name', f.name),
    el('label', {}, 'Game', f.game),
    el('label', {}, 'Player cap', f.cap),
    el('label', {}, 'Post embed in', f.channel),
    el('label', {}, 'Voice channel', f.voice),
    el('label', { class: 'span-2' }, 'Description', f.desc),
    el('div', { class: 'span-2 toolbar' },
      el('button', { type: 'submit' }, 'Create party'),
      el('button', { type: 'button', class: 'secondary', onclick: () => box.replaceChildren() }, 'Cancel'),
    ),
  )
  form.addEventListener('submit', async e => {
    e.preventDefault()
    try {
      await api('/parties', { method: 'POST', body: JSON.stringify({
        ownerId: f.owner.value.trim(),
        name: f.name.value,
        game: f.game.value,
        maxSize: Number(f.cap.value),
        channelId: f.channel.value,
        voiceChannelId: f.voice.value || undefined,
        description: f.desc.value,
      }) })
      toast('Party created')
      box.replaceChildren()
      refreshParties()
    } catch (err) { toast(err.message, 'err') }
  })

  box.replaceChildren(el('article', {}, el('h5', {}, 'New party'), form))
}

function statusPill(p) {
  if (p.isClosed) return el('span', { class: 'pill pill-closed' }, '🔒 closed')
  if (p.members.length >= p.maxSize) return el('span', { class: 'pill pill-full' }, '🟡 full')
  return el('span', { class: 'pill pill-open' }, '🟢 open')
}

function memberLine(p, m) {
  return el('div', { class: 'row' },
    el('div', { class: 'who' },
      m.userId === p.ownerId ? el('span', { class: 'crown' }, '👑') : null,
      el('strong', {}, m.displayName),
      m.ign ? ' (' + m.ign + ')' : null,
      ' ',
      el('span', { class: 'uid' }, m.userId),
    ),
    el('a', { class: 'tiny', href: '#/users', onclick: () => { sessionStorage.setItem('pb-user-lookup', m.userId) } }, 'profile'),
    m.userId !== p.ownerId ? el('button', { class: 'tiny secondary', onclick: async () => {
      if (!confirm('Promote ' + m.displayName + ' to owner of ' + p.name + '?')) return
      try { await api('/parties/' + p.id + '/members/' + m.userId + '/promote', { method: 'POST' }); toast('Promoted'); refreshParties() }
      catch (e) { toast(e.message, 'err') }
    } }, 'Promote') : null,
    m.userId !== p.ownerId ? el('button', { class: 'tiny danger', onclick: async () => {
      try { await api('/parties/' + p.id + '/members/' + m.userId, { method: 'DELETE' }); toast('Removed'); refreshParties() }
      catch (e) { toast(e.message, 'err') }
    } }, 'Remove') : el('span', { class: 'muted' }, 'owner'),
  )
}

function queueLine(p, q, idx) {
  const move = async (direction) => {
    try {
      await api('/parties/' + p.id + '/queue/' + q.userId + '/move', {
        method: 'POST', body: JSON.stringify({ direction }),
      })
      refreshParties()
    } catch (e) { toast(e.message, 'err') }
  }
  return el('div', { class: 'row' },
    el('div', { class: 'who' },
      el('strong', {}, q.displayName),
      q.ign ? ' (' + q.ign + ')' : null,
      ' ',
      el('span', { class: 'uid' }, q.userId),
    ),
    el('button', { class: 'tiny secondary', disabled: idx === 0 ? 'disabled' : null, onclick: () => move('up') }, '↑'),
    el('button', { class: 'tiny secondary', disabled: idx === p.queue.length - 1 ? 'disabled' : null, onclick: () => move('down') }, '↓'),
    el('button', { class: 'tiny', onclick: async () => {
      try { await api('/parties/' + p.id + '/members/' + q.userId + '/approve', { method: 'POST' }); toast('Approved'); refreshParties() }
      catch (e) { toast(e.message, 'err') }
    } }, 'Approve'),
    el('button', { class: 'tiny secondary', onclick: async () => {
      try { await api('/parties/' + p.id + '/queue/' + q.userId, { method: 'DELETE' }); toast('Denied'); refreshParties() }
      catch (e) { toast(e.message, 'err') }
    } }, 'Deny'),
  )
}

function renderParty(p, isOpen = false) {
  const last = p.lastActivityAt ?? p.createdAt
  const deadline = deadlineOf(p)
  const now = Date.now()
  const lastLabel = last <= now ? relTime(now - last) + ' ago' : 'just now'
  const dueLabel = deadline > now ? 'in ' + relTime(deadline - now) : 'overdue'
  const summary = el('summary', {}, el('div', { class: 'summary-row' },
    el('span', { class: 'name' }, p.name),
    el('span', { class: 'meta' }, p.game + ' · ' + p.members.length + '/' + p.maxSize + (p.queue.length ? ' · ' + p.queue.length + ' queued' : '')),
    statusPill(p),
    el('span', { class: 'meta', title: 'Auto-disband ' + fmtAbs(deadline) }, '⏱ ' + dueLabel),
    el('span', { class: 'uid muted' }, p.id),
  ))

  const vcs = voiceChannels || []
  const settingsForm = el('form', { class: 'grid-2' },
    el('label', {}, 'Name', el('input', { name: 'name', value: p.name, required: true, maxlength: 100 })),
    el('label', {}, 'Player cap',
      el('input', { type: 'number', name: 'cap', value: p.maxSize, min: 2, max: 50, required: true })),
    el('label', {}, 'Game',
      el('select', { name: 'game' },
        ...GAMES.map(g => el('option', { value: g, selected: g === p.game ? 'selected' : null }, g))
      )
    ),
    el('label', {}, 'Voice channel',
      el('select', { name: 'voice' },
        ...vcs.map(c => el('option', { value: c.id, selected: c.id === p.voiceChannelId ? 'selected' : null }, '#' + c.name)),
        ...(p.voiceChannelId && !vcs.find(c => c.id === p.voiceChannelId)
          ? [el('option', { value: p.voiceChannelId, selected: 'selected' }, '(unknown: ' + p.voiceChannelId + ')')]
          : []),
      )
    ),
    el('label', { class: 'span-2' }, 'Description',
      el('textarea', { name: 'description' }, p.description || '')
    ),
  )
  settingsForm.addEventListener('submit', e => e.preventDefault())

  const saveSettings = async () => {
    const fd = new FormData(settingsForm)
    try {
      await api('/parties/' + p.id, {
        method: 'PATCH',
        body: JSON.stringify({
          name: fd.get('name'),
          description: fd.get('description'),
          maxSize: Number(fd.get('cap')),
          game: fd.get('game'),
          voiceChannelId: fd.get('voice'),
        }),
      })
      toast('Saved'); refreshParties()
    } catch (err) { toast(err.message, 'err') }
  }

  const settingsActions = el('div', { class: 'toolbar' },
    el('button', { type: 'button', onclick: saveSettings }, 'Save'),
    el('button', { type: 'button', class: 'secondary', onclick: async () => {
      try {
        await api('/parties/' + p.id + (p.isClosed ? '/open' : '/close'), { method: 'POST' })
        toast(p.isClosed ? 'Opened' : 'Closed'); refreshParties()
      } catch (err) { toast(err.message, 'err') }
    } }, p.isClosed ? 'Open party' : 'Close party'),
    el('button', { type: 'button', class: 'secondary', onclick: async () => {
      try { await api('/parties/' + p.id + '/bump', { method: 'POST', body: JSON.stringify({}) }); toast('Bumped'); refreshParties() }
      catch (err) { toast(err.message, 'err') }
    } }, 'Bump embed'),
    el('span', { class: 'grow' }),
    el('button', { type: 'button', class: 'danger', onclick: async () => {
      if (!confirm('Disband "' + p.name + '"?')) return
      try { await api('/parties/' + p.id, { method: 'DELETE' }); toast('Disbanded'); refreshParties() }
      catch (err) { toast(err.message, 'err') }
    } }, 'Disband'),
  )

  const addInput = el('input', { name: 'userId', placeholder: 'Discord user ID', required: true })
  const addForm = el('form', { class: 'toolbar' },
    el('div', { class: 'grow' }, addInput),
    el('button', { type: 'submit' }, 'Add'),
  )
  addForm.addEventListener('submit', async e => {
    e.preventDefault()
    const userId = addInput.value.trim()
    if (!userId) return
    try { await api('/parties/' + p.id + '/members', { method: 'POST', body: JSON.stringify({ userId }) }); toast('Added'); refreshParties() }
    catch (err) { toast(err.message, 'err') }
  })

  const banText = (p.banlist && p.banlist.source) ? p.banlist.source.join('\\n') : ''
  const banArea = el('textarea', { name: 'banlist', class: 'bans', placeholder: 'one champion per line' }, banText)
  const banActions = el('div', { class: 'toolbar' },
    el('button', { type: 'button', onclick: async () => {
      try { await api('/parties/' + p.id + '/banlist', { method: 'PATCH', body: JSON.stringify({ banlist: banArea.value }) }); toast('Banlist saved'); refreshParties() }
      catch (err) { toast(err.message, 'err') }
    } }, 'Save banlist'),
    el('button', { type: 'button', class: 'secondary', onclick: async () => {
      try { await api('/parties/' + p.id + '/banlist', { method: 'PATCH', body: JSON.stringify({ banlist: '' }) }); toast('Cleared'); refreshParties() }
      catch (err) { toast(err.message, 'err') }
    } }, 'Clear'),
  )

  const voiceBox = el('span', { class: 'muted' })
  const voiceBtn = el('button', { class: 'tiny secondary', onclick: async () => {
    voiceBtn.setAttribute('aria-busy', 'true')
    try {
      const v = await api('/parties/' + p.id + '/voice')
      const nameOf = id => {
        const m = p.members.find(x => x.userId === id)
        return m ? m.displayName : id
      }
      const inLinked = v.states.filter(s => v.voiceChannelId && s.channelId === v.voiceChannelId)
      const elsewhere = v.states.filter(s => s.channelId && s.channelId !== v.voiceChannelId)
      const offline = v.states.filter(s => !s.channelId)
      const parts = []
      if (v.voiceChannelId) {
        parts.push('🔊 ' + inLinked.length + '/' + v.states.length + ' in linked VC' +
          (inLinked.length ? ': ' + inLinked.map(s => nameOf(s.userId)).join(', ') : ''))
      }
      if (elsewhere.length) parts.push('elsewhere: ' + elsewhere.map(s => nameOf(s.userId)).join(', '))
      if (offline.length) parts.push('not in voice: ' + offline.map(s => nameOf(s.userId)).join(', '))
      voiceBox.textContent = parts.join(' · ') || 'No members in voice.'
    } catch (e) { toast(e.message, 'err') }
    voiceBtn.removeAttribute('aria-busy')
  } }, 'Check voice')

  const body = el('div', { class: 'body' },
    el('div', { class: 'muted activity' },
      el('span', { title: fmtAbs(last) }, 'Last activity: ' + lastLabel),
      el('span', {}, ' · '),
      el('span', { title: fmtAbs(deadline) }, 'Auto-disband: ' + dueLabel),
    ),
    el('div', { class: 'toolbar', style: 'margin: 0 0 0.6rem' }, voiceBtn, voiceBox),
    el('h5', {}, 'Settings'),
    settingsForm,
    settingsActions,
    el('h5', {}, 'Members (' + p.members.length + '/' + p.maxSize + ')'),
    ...p.members.map(m => memberLine(p, m)),
    p.queue.length > 0 ? el('h5', {}, 'Queue (' + p.queue.length + ')') : null,
    ...p.queue.map((q, i) => queueLine(p, q, i)),
    el('h5', {}, 'Add member'),
    addForm,
    el('h5', {}, 'Banlist'),
    banArea,
    banActions,
  )

  return el('details', { class: 'party', 'data-party-id': p.id, open: isOpen ? 'open' : null }, summary, body)
}

// ── Users tab ────────────────────────────────────────────────────────────────
async function viewUsers(view) {
  if (lastParties.length === 0) {
    try { lastParties = await api('/parties') } catch (e) { /* lookup still works */ }
  }

  const known = new Map()
  for (const p of lastParties) {
    for (const m of p.members) known.set(m.userId, m.displayName)
    for (const q of p.queue) known.set(q.userId, q.displayName)
  }
  const datalist = el('datalist', { id: 'known-users' },
    [...known.entries()].map(([id, name]) => el('option', { value: id }, name)))

  const input = el('input', { type: 'text', placeholder: 'Discord user ID', list: 'known-users', autocomplete: 'off' })
  const result = el('div', { id: 'uresult' })
  const form = el('form', { class: 'toolbar' },
    el('div', { class: 'grow' }, input),
    el('button', { type: 'submit' }, 'Look up'),
  )
  form.addEventListener('submit', e => {
    e.preventDefault()
    const id = input.value.trim()
    if (id) lookupUser(id, result)
  })

  view.replaceChildren(
    el('p', { class: 'muted' }, 'Look up a member to inspect their IGN profile and party state.'),
    form, datalist, result,
  )

  const pending = sessionStorage.getItem('pb-user-lookup')
  if (pending) {
    sessionStorage.removeItem('pb-user-lookup')
    input.value = pending
    lookupUser(pending, result)
  }
}

async function lookupUser(userId, box) {
  box.replaceChildren(el('progress'))
  let u
  try { u = await api('/users/' + encodeURIComponent(userId)) }
  catch (e) { box.replaceChildren(el('article', {}, 'Error: ' + e.message)); return }

  const head = u.member
    ? el('div', {}, el('strong', {}, u.member.displayName), ' ', el('span', { class: 'muted' }, '@' + u.member.username))
    : el('div', { class: 'warn' }, 'Not a member of this guild')

  let partyInfo
  if (!u.partyId) {
    partyInfo = el('p', { class: 'muted' }, 'Not in any party.')
  } else if (u.inParty) {
    const entry = lastParties.find(p => p.id === u.partyId)
    partyInfo = el('p', {}, 'In party ', el('strong', {}, entry ? entry.name : u.partyId), ' ', el('span', { class: 'uid' }, u.partyId))
  } else {
    partyInfo = el('div', { class: 'toolbar' },
      el('span', { class: 'warn' }, 'Stale mapping → party ' + u.partyId + (u.partyExists ? ' (not a member)' : ' (party gone)')),
      el('button', { class: 'tiny', onclick: async () => {
        try { await api('/users/' + u.userId + '/unstick', { method: 'POST' }); toast('Mapping cleared'); lookupUser(u.userId, box) }
        catch (e) { toast(e.message, 'err') }
      } }, 'Clear mapping'),
    )
  }

  const ignRows = GAMES.map(g => {
    const field = el('input', { value: u.profile.igns[g] || '', placeholder: '—', maxlength: 100 })
    return el('div', { class: 'ign-row' },
      el('label', {}, g),
      field,
      el('button', { class: 'tiny secondary', onclick: async () => {
        try {
          await api('/users/' + u.userId + '/profile', { method: 'PATCH', body: JSON.stringify({ game: g, ign: field.value }) })
          toast(field.value.trim() ? 'IGN saved' : 'IGN cleared')
        } catch (e) { toast(e.message, 'err') }
      } }, 'Save'),
    )
  })

  box.replaceChildren(el('article', {},
    head,
    el('p', { class: 'uid' }, u.userId),
    partyInfo,
    el('h5', {}, 'In-game names'),
    ...ignRows,
  ))
}

// ── Audit tab ────────────────────────────────────────────────────────────────
function friendlyAction(entry) {
  const parts = entry.path.split('/').filter(Boolean)
  const m = entry.method
  const p0 = parts[0], p1 = parts[1], p2 = parts[2], p3 = parts[3]

  if (p0 === 'clear') return 'Cleared all parties'
  if (p0 === 'settings') return 'Updated guild settings'
  if (p0 === 'parties' && !p1) return 'Created a party'
  if (p0 === 'parties' && p1) {
    if (!p2) return (m === 'DELETE' ? 'Disbanded' : 'Edited') + ' party ' + p1
    if (p2 === 'close') return 'Closed party ' + p1
    if (p2 === 'open') return 'Opened party ' + p1
    if (p2 === 'bump') return 'Bumped embed for party ' + p1
    if (p2 === 'banlist') return 'Updated banlist for party ' + p1
    if (p2 === 'members' && !p3) return 'Added a member to party ' + p1
    if (p2 === 'members' && p3) {
      if (parts[4] === 'approve') return 'Approved ' + p3 + ' into party ' + p1
      if (parts[4] === 'promote') return 'Promoted ' + p3 + ' in party ' + p1
      return 'Removed ' + p3 + ' from party ' + p1
    }
    if (p2 === 'queue' && p3) {
      if (parts[4] === 'move') return 'Reordered ' + p3 + ' in queue of party ' + p1
      return 'Denied ' + p3 + ' from queue of party ' + p1
    }
  }
  if (p0 === 'users' && p1) {
    if (p2 === 'profile') return 'Edited IGN profile of ' + p1
    if (p2 === 'unstick') return 'Cleared stale party mapping of ' + p1
  }
  return m + ' ' + entry.path
}

async function viewAudit(view) {
  const log = await api('/log')
  if (log.length === 0) {
    view.replaceChildren(el('div', { class: 'empty' }, 'No admin actions recorded yet.'))
    return
  }
  const table = el('table', { class: 'compact' },
    el('thead', {}, el('tr', {}, el('th', {}, 'When'), el('th', {}, 'Admin'), el('th', {}, 'Action'))),
    el('tbody', {}, log.map(entry => el('tr', {},
      el('td', { title: fmtAbs(entry.ts) }, relTime(Date.now() - entry.ts) + ' ago'),
      el('td', {}, entry.email || '—'),
      el('td', {}, friendlyAction(entry)),
    ))),
  )
  view.replaceChildren(
    el('div', { class: 'toolbar' },
      el('span', { class: 'muted grow' }, log.length + ' recorded action' + (log.length === 1 ? '' : 's')),
      el('button', { class: 'secondary tiny', onclick: renderTab }, 'Refresh'),
    ),
    el('article', {}, table),
  )
}

// ── Settings tab ─────────────────────────────────────────────────────────────
async function viewSettings(view) {
  const s = await getSettings(true)

  const maxParties = el('input', { type: 'number', min: 1, max: 50, value: s.maxParties })
  const defaultCap = el('input', { type: 'number', min: 2, max: 50, value: s.defaultCap })
  const gameBoxes = GAMES.map(g =>
    el('label', { style: 'display:flex;align-items:center;gap:0.4rem' },
      el('input', { type: 'checkbox', value: g, checked: s.allowedGames.includes(g) ? 'checked' : null }),
      g))

  const form = el('form', {},
    el('div', { class: 'grid-2' },
      el('label', {}, 'Max concurrent parties (1–50)', maxParties),
      el('label', {}, 'Default player cap in create modal (2–50)', defaultCap),
    ),
    el('h5', {}, 'Allowed games'),
    el('p', { class: 'muted' }, 'Leave all unchecked to allow every game.'),
    el('div', { class: 'grid-2' }, gameBoxes),
    el('div', { class: 'toolbar' }, el('button', { type: 'submit' }, 'Save settings')),
  )
  form.addEventListener('submit', async e => {
    e.preventDefault()
    const allowedGames = gameBoxes
      .map(label => label.querySelector('input'))
      .filter(box => box.checked)
      .map(box => box.value)
    try {
      settings = await api('/settings', { method: 'PATCH', body: JSON.stringify({
        maxParties: Number(maxParties.value),
        defaultCap: Number(defaultCap.value),
        allowedGames,
      }) })
      toast('Settings saved')
    } catch (err) { toast(err.message, 'err') }
  })

  view.replaceChildren(el('article', {},
    el('h5', {}, 'Guild settings'),
    el('p', { class: 'muted' }, 'These are enforced by the bot when members create or edit parties.'),
    form,
  ))
}
`
