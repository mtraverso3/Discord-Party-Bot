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

let expiredShown = false
function showSessionExpired() {
  if (expiredShown) return
  expiredShown = true
  document.body.prepend(el('div', { id: 'expired' },
    'Your Cloudflare Access session has expired.',
    el('button', { type: 'button', onclick: () => location.reload() }, 'Reload to sign in'),
  ))
}

async function api(path, opts = {}) {
  const sep = path.includes('?') ? '&' : '?'
  const url = '/admin/api' + path + (guildId ? sep + 'guild=' + encodeURIComponent(guildId) : '')
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  const ct = res.headers.get('content-type') || ''

  // An expired Access session shows up as a redirect to the team login page,
  // or as a non-JSON 401/403 (the Worker's own JWT check, or Access itself).
  const authFailed =
    (res.redirected && res.url.includes('cloudflareaccess.com')) ||
    ((res.status === 401 || res.status === 403) && !ct.includes('json')) ||
    (res.ok && ct.includes('html'))
  if (authFailed) {
    showSessionExpired()
    throw new Error('Session expired — reload to sign in again.')
  }

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

function isSnowflake(s) {
  if (!s || s.length < 15 || s.length > 21) return false
  for (const ch of s) if (ch < '0' || ch > '9') return false
  return true
}

// Input that searches guild members by name (debounced) and also accepts a
// pasted user ID. getId() returns the chosen/pasted ID or '' if neither.
function userPicker(placeholder, onPick) {
  const input = el('input', { type: 'text', placeholder, autocomplete: 'off' })
  const list = el('div', { class: 'upick-list', hidden: true })
  const node = el('div', { class: 'upick' }, input, list)
  let chosen = null
  let timer = null

  const close = () => { list.hidden = true; list.replaceChildren() }
  input.addEventListener('input', () => {
    chosen = null
    clearTimeout(timer)
    const q = input.value.trim()
    if (q.length < 2 || isSnowflake(q)) return close()
    timer = setTimeout(async () => {
      let results = []
      try { results = await api('/members?q=' + encodeURIComponent(q)) } catch (e) { /* keep closed */ }
      if (input.value.trim() !== q) return  // stale response
      if (results.length === 0) return close()
      list.replaceChildren(...results.map(u =>
        el('button', { type: 'button', class: 'upick-item', onclick: () => {
          chosen = u
          input.value = u.displayName + ' (' + u.id + ')'
          close()
          if (onPick) onPick(u)
        } }, el('strong', {}, u.displayName), el('span', { class: 'muted' }, '@' + u.username), el('span', { class: 'uid' }, u.id))))
      list.hidden = false
    }, 300)
  })
  input.addEventListener('keydown', e => { if (e.key === 'Escape') close() })

  return {
    node,
    input,
    getId: () => {
      if (chosen) return chosen.id
      const v = input.value.trim()
      return isSnowflake(v) ? v : ''
    },
    setValue: v => { chosen = null; input.value = v },
    clear: () => { chosen = null; input.value = ''; close() },
  }
}

// Promise-based replacement for window.confirm using a styled <dialog>.
function confirmDialog(message, confirmLabel) {
  return new Promise(resolve => {
    let done = false
    const finish = v => { if (done) return; done = true; dlg.close(); resolve(v) }
    const dlg = el('dialog', { class: 'confirm' },
      el('p', {}, message),
      el('div', { class: 'dlg-actions' },
        el('button', { type: 'button', class: 'ghost', onclick: () => finish(false) }, 'Cancel'),
        el('button', { type: 'button', class: 'danger', onclick: () => finish(true) }, confirmLabel || 'Confirm'),
      ),
    )
    dlg.addEventListener('close', () => { dlg.remove(); if (!done) { done = true; resolve(false) } })
    dlg.addEventListener('click', e => { if (e.target === dlg) finish(false) })
    document.body.append(dlg)
    dlg.showModal()
  })
}

function hueOf(s) {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}
function avatar(name) {
  const n = name || '?'
  return el('span', { class: 'av', style: 'background: hsl(' + hueOf(n) + ', 48%, 46%)' }, n.slice(0, 1).toUpperCase())
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
    el('button', { class: 'tiny ghost', onclick: refreshParties }, 'Refresh'),
    el('button', { class: 'tiny', onclick: () => toggleCreateForm(createBox) }, 'New party'),
    el('button', { class: 'tiny ghost-danger', onclick: async () => {
      if (!(await confirmDialog('Disband ALL parties in this guild? This cannot be undone.', 'Disband all'))) return
      try { await api('/clear', { method: 'POST' }); toast('Cleared'); refreshParties() }
      catch (e) { toast(e.message, 'err') }
    } }, 'Clear all…'),
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

// Most mutation endpoints return the updated party — patch it into the local
// cache and re-render from there instead of re-fetching every party (one DO
// round-trip each).
function applyPartyUpdate(p) {
  if (!p || !p.id) return refreshParties()
  const i = lastParties.findIndex(x => x.id === p.id)
  if (i === -1) lastParties.push(p)
  else lastParties[i] = p
  renderPartyList()
}

function removePartyLocal(id) {
  lastParties = lastParties.filter(p => p.id !== id)
  renderPartyList()
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

  const ownerPicker = userPicker('Search member by name, or paste an ID')
  const f = {
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
    el('label', {}, 'Owner', ownerPicker.node),
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
    const ownerId = ownerPicker.getId()
    if (!ownerId) return toast('Pick an owner from the list or paste a user ID.', 'err')
    try {
      applyPartyUpdate(await api('/parties', { method: 'POST', body: JSON.stringify({
        ownerId,
        name: f.name.value,
        game: f.game.value,
        maxSize: Number(f.cap.value),
        channelId: f.channel.value,
        voiceChannelId: f.voice.value || undefined,
        description: f.desc.value,
      }) }))
      toast('Party created')
      box.replaceChildren()
    } catch (err) { toast(err.message, 'err') }
  })

  box.replaceChildren(el('article', {}, el('h5', {}, 'New party'), form))
}

function statusBadge(p) {
  const s = p.isClosed ? ['closed', 'Closed']
    : p.members.length >= p.maxSize ? ['full', 'Full']
    : ['open', 'Open']
  return el('span', { class: 'status st-' + s[0] }, el('span', { class: 'dot' }), s[1])
}

function memberLine(p, m) {
  return el('div', { class: 'row' },
    avatar(m.displayName),
    el('div', { class: 'who' },
      el('div', {},
        el('strong', {}, m.displayName),
        m.userId === p.ownerId ? el('span', { class: 'crown', title: 'Party owner' }, ' 👑') : null,
        m.ign ? el('span', { class: 'muted' }, '  ' + m.ign) : null,
      ),
      el('div', { class: 'uid' }, m.userId),
    ),
    el('button', { class: 'tiny ghost', onclick: () => {
      sessionStorage.setItem('pb-user-lookup', m.userId)
      location.hash = '#/users'
    } }, 'Profile'),
    m.userId !== p.ownerId ? el('button', { class: 'tiny ghost', onclick: async () => {
      if (!(await confirmDialog('Promote ' + m.displayName + ' to owner of "' + p.name + '"?', 'Promote'))) return
      try { applyPartyUpdate(await api('/parties/' + p.id + '/members/' + m.userId + '/promote', { method: 'POST' })); toast('Promoted') }
      catch (e) { toast(e.message, 'err') }
    } }, 'Promote') : null,
    m.userId !== p.ownerId ? el('button', { class: 'tiny ghost-danger', onclick: async () => {
      try { applyPartyUpdate(await api('/parties/' + p.id + '/members/' + m.userId, { method: 'DELETE' })); toast('Removed') }
      catch (e) { toast(e.message, 'err') }
    } }, 'Remove') : el('span', { class: 'chip' }, 'owner'),
  )
}

function queueLine(p, q, idx) {
  const move = async (direction) => {
    try {
      applyPartyUpdate(await api('/parties/' + p.id + '/queue/' + q.userId + '/move', {
        method: 'POST', body: JSON.stringify({ direction }),
      }))
    } catch (e) { toast(e.message, 'err') }
  }
  return el('div', { class: 'row' },
    el('span', { class: 'qpos' }, String(idx + 1)),
    avatar(q.displayName),
    el('div', { class: 'who' },
      el('div', {},
        el('strong', {}, q.displayName),
        q.ign ? el('span', { class: 'muted' }, '  ' + q.ign) : null,
      ),
      el('div', { class: 'uid' }, q.userId),
    ),
    el('button', { class: 'tiny ghost', title: 'Move up', disabled: idx === 0 ? 'disabled' : null, onclick: () => move('up') }, '↑'),
    el('button', { class: 'tiny ghost', title: 'Move down', disabled: idx === p.queue.length - 1 ? 'disabled' : null, onclick: () => move('down') }, '↓'),
    el('button', { class: 'tiny', onclick: async () => {
      try { applyPartyUpdate(await api('/parties/' + p.id + '/members/' + q.userId + '/approve', { method: 'POST' })); toast('Approved') }
      catch (e) { toast(e.message, 'err') }
    } }, 'Approve'),
    el('button', { class: 'tiny ghost-danger', onclick: async () => {
      try { applyPartyUpdate(await api('/parties/' + p.id + '/queue/' + q.userId, { method: 'DELETE' })); toast('Denied') }
      catch (e) { toast(e.message, 'err') }
    } }, 'Deny'),
  )
}

// ── Party card sections ──────────────────────────────────────────────────────

function buildPeopleSection(p) {
  const addPicker = userPicker('Add a member — search by name or paste an ID')
  const addForm = el('form', { class: 'toolbar addbar' },
    el('div', { class: 'grow' }, addPicker.node),
    el('button', { type: 'submit', class: 'tiny' }, 'Add'),
  )
  addForm.addEventListener('submit', async e => {
    e.preventDefault()
    const userId = addPicker.getId()
    if (!userId) return toast('Pick a member from the list or paste a user ID.', 'err')
    try { applyPartyUpdate(await api('/parties/' + p.id + '/members', { method: 'POST', body: JSON.stringify({ userId }) })); toast('Added'); addPicker.clear() }
    catch (err) { toast(err.message, 'err') }
  })

  const voiceBox = el('span', { class: 'muted' })
  const voiceBtn = el('button', { class: 'tiny ghost', onclick: async () => {
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

  return el('div', {},
    ...p.members.map(m => memberLine(p, m)),
    p.queue.length > 0 ? el('div', { class: 'subhead' }, 'Queue — ' + p.queue.length + ' waiting') : null,
    ...p.queue.map((q, i) => queueLine(p, q, i)),
    addForm,
    el('div', { class: 'toolbar voicebar' }, voiceBtn, voiceBox),
  )
}

function buildSettingsSection(p) {
  const last = p.lastActivityAt ?? p.createdAt
  const deadline = deadlineOf(p)
  const now = Date.now()
  const lastLabel = last <= now ? relTime(now - last) + ' ago' : 'just now'
  const dueLabel = deadline > now ? 'in ' + relTime(deadline - now) : 'overdue'

  const vcs = voiceChannels || []
  const form = el('form', { class: 'grid-2' },
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
  form.addEventListener('submit', e => e.preventDefault())

  const save = async () => {
    const fd = new FormData(form)
    try {
      applyPartyUpdate(await api('/parties/' + p.id, {
        method: 'PATCH',
        body: JSON.stringify({
          name: fd.get('name'),
          description: fd.get('description'),
          maxSize: Number(fd.get('cap')),
          game: fd.get('game'),
          voiceChannelId: fd.get('voice'),
        }),
      }))
      toast('Saved')
    } catch (err) { toast(err.message, 'err') }
  }

  return el('div', {},
    el('div', { class: 'muted activity' },
      el('span', { title: fmtAbs(last) }, 'Last activity: ' + lastLabel),
      el('span', {}, ' · '),
      el('span', { title: fmtAbs(deadline) }, 'Auto-disband: ' + dueLabel),
    ),
    form,
    el('div', { class: 'toolbar' },
      el('button', { type: 'button', class: 'tiny', onclick: save }, 'Save changes'),
      el('button', { type: 'button', class: 'tiny ghost', onclick: async () => {
        try {
          applyPartyUpdate(await api('/parties/' + p.id + (p.isClosed ? '/open' : '/close'), { method: 'POST' }))
          toast(p.isClosed ? 'Opened' : 'Closed')
        } catch (err) { toast(err.message, 'err') }
      } }, p.isClosed ? 'Open party' : 'Close party'),
      el('button', { type: 'button', class: 'tiny ghost', onclick: async () => {
        try { applyPartyUpdate(await api('/parties/' + p.id + '/bump', { method: 'POST', body: JSON.stringify({}) })); toast('Bumped') }
        catch (err) { toast(err.message, 'err') }
      } }, 'Bump embed'),
      el('span', { class: 'grow' }),
      el('button', { type: 'button', class: 'tiny ghost-danger', onclick: async () => {
        if (!(await confirmDialog('Disband "' + p.name + '"? Members will be released and the embed marked disbanded.', 'Disband'))) return
        try { await api('/parties/' + p.id, { method: 'DELETE' }); removePartyLocal(p.id); toast('Disbanded') }
        catch (err) { toast(err.message, 'err') }
      } }, 'Disband…'),
    ),
  )
}

function buildBanlistSection(p) {
  const banText = (p.banlist && p.banlist.source) ? p.banlist.source.join('\\n') : ''
  const banArea = el('textarea', { name: 'banlist', class: 'bans', placeholder: 'One champion per line — assigned to members in order' }, banText)
  return el('div', {},
    el('p', { class: 'muted', style: 'margin: 0 0 0.4rem' }, 'Members are assigned one ban each, in paste order. Freed bans recycle to the next joiner.'),
    banArea,
    el('div', { class: 'toolbar' },
      el('button', { type: 'button', class: 'tiny', onclick: async () => {
        try { applyPartyUpdate(await api('/parties/' + p.id + '/banlist', { method: 'PATCH', body: JSON.stringify({ banlist: banArea.value }) })); toast('Banlist saved') }
        catch (err) { toast(err.message, 'err') }
      } }, 'Save banlist'),
      el('button', { type: 'button', class: 'tiny ghost', onclick: async () => {
        try { applyPartyUpdate(await api('/parties/' + p.id + '/banlist', { method: 'PATCH', body: JSON.stringify({ banlist: '' }) })); toast('Cleared') }
        catch (err) { toast(err.message, 'err') }
      } }, 'Clear'),
    ),
  )
}

// Remembers which section of each card is selected across re-renders.
const cardSection = new Map()

function renderParty(p, isOpen = false) {
  const deadline = deadlineOf(p)
  const now = Date.now()
  const dueLabel = deadline > now ? 'in ' + relTime(deadline - now) : 'overdue'

  const summary = el('summary', {}, el('div', { class: 'summary-row' },
    statusBadge(p),
    el('span', { class: 'name' }, p.name),
    el('span', { class: 'chip' }, p.game),
    el('span', { class: 'chip' }, p.members.length + '/' + p.maxSize),
    p.queue.length ? el('span', { class: 'chip chip-warn' }, p.queue.length + ' queued') : null,
    el('span', { class: 'grow' }),
    el('span', { class: 'meta', title: 'Auto-disband ' + fmtAbs(deadline) }, '⏱ ' + dueLabel),
    el('span', { class: 'uid' }, p.id),
  ))

  const sections = {
    people: buildPeopleSection(p),
    settings: buildSettingsSection(p),
    banlist: buildBanlistSection(p),
  }
  const segBtns = {}
  const sectionBox = el('div')
  const showSection = id => {
    cardSection.set(p.id, id)
    for (const k of Object.keys(segBtns)) segBtns[k].classList.toggle('active', k === id)
    sectionBox.replaceChildren(sections[id])
  }
  const tabs = [
    ['people', 'People (' + (p.members.length + p.queue.length) + ')'],
    ['settings', 'Settings'],
    ['banlist', 'Banlist' + (p.banlist ? ' (' + p.banlist.source.length + ')' : '')],
  ]
  const seg = el('div', { class: 'seg' }, tabs.map(([id, label]) => {
    const b = el('button', { type: 'button', class: 'seg-btn', onclick: () => showSection(id) }, label)
    segBtns[id] = b
    return b
  }))

  const body = el('div', { class: 'body' }, seg, sectionBox)
  showSection(cardSection.get(p.id) || 'people')

  return el('details', { class: 'party', 'data-party-id': p.id, open: isOpen ? 'open' : null }, summary, body)
}

// ── Users tab ────────────────────────────────────────────────────────────────
async function viewUsers(view) {
  if (lastParties.length === 0) {
    try { lastParties = await api('/parties') } catch (e) { /* lookup still works */ }
  }

  const result = el('div', { id: 'uresult' })
  const picker = userPicker('Search member by name, or paste an ID', u => lookupUser(u.id, result))
  const form = el('form', { class: 'toolbar' },
    el('div', { class: 'grow' }, picker.node),
    el('button', { type: 'submit' }, 'Look up'),
  )
  form.addEventListener('submit', e => {
    e.preventDefault()
    const id = picker.getId()
    if (id) lookupUser(id, result)
    else toast('Pick a member from the list or paste a user ID.', 'err')
  })

  view.replaceChildren(
    el('p', { class: 'muted' }, 'Look up a member to inspect their IGN profile and party state.'),
    form, result,
  )

  const pending = sessionStorage.getItem('pb-user-lookup')
  if (pending) {
    sessionStorage.removeItem('pb-user-lookup')
    picker.setValue(pending)
    lookupUser(pending, result)
  }
}

async function lookupUser(userId, box) {
  box.replaceChildren(el('progress'))
  let u
  try { u = await api('/users/' + encodeURIComponent(userId)) }
  catch (e) { box.replaceChildren(el('article', {}, 'Error: ' + e.message)); return }

  const head = u.member
    ? el('div', { class: 'uhead' },
        avatar(u.member.displayName),
        el('div', {},
          el('strong', {}, u.member.displayName), ' ',
          el('span', { class: 'muted' }, '@' + u.member.username)))
    : el('div', {}, el('span', { class: 'warn' }, 'Not a member of this guild'))

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

  // Desktop client inviter allowlist: list of user IDs, displayed with names
  // when we can resolve them, edited via the member search picker.
  let inviters = (s.clientInviters || []).slice()
  const inviterNames = {}
  const inviterList = el('div', { class: 'inviter-list' })
  const renderInviters = () => {
    inviterList.replaceChildren(
      inviters.length === 0 ? el('span', { class: 'muted' }, 'No extra inviters — only party owners can invite.') : null,
      ...inviters.map(id =>
        el('span', { class: 'chip' },
          inviterNames[id] || id,
          el('button', { type: 'button', class: 'chip-x', title: 'Remove', onclick: () => {
            inviters = inviters.filter(x => x !== id)
            renderInviters()
          } }, '\\u00d7'),
        )),
    )
  }
  renderInviters()
  inviters.forEach(async id => {
    try {
      const u = await api('/users/' + id)
      if (u && u.member && u.member.displayName) { inviterNames[id] = u.member.displayName; renderInviters() }
    } catch (e) { /* show raw ID */ }
  })
  const inviterPicker = userPicker('Add a member who may lobby-invite from the desktop client', u => {
    if (!inviters.includes(u.id)) {
      inviters.push(u.id)
      inviterNames[u.id] = u.displayName
      renderInviters()
    }
    inviterPicker.clear()
  })

  const form = el('form', {},
    el('div', { class: 'grid-2' },
      el('label', {}, 'Max concurrent parties (1–50)', maxParties),
      el('label', {}, 'Default player cap in create modal (2–50)', defaultCap),
    ),
    el('h5', {}, 'Allowed games'),
    el('p', { class: 'muted' }, 'Leave all unchecked to allow every game.'),
    el('div', { class: 'grid-2' }, gameBoxes),
    el('h5', {}, 'Desktop client inviters'),
    el('p', { class: 'muted' }, 'Party owners can always send League lobby invites from the desktop client. Members listed here can too.'),
    inviterList,
    inviterPicker.node,
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
        clientInviters: inviters,
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
