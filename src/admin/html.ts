import { GAMES } from '../lib/games'

const GAMES_JSON = JSON.stringify(GAMES.map(g => g.value))

export const ADMIN_HTML = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PartyBot Admin</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
<style>
  :root { --pico-form-element-spacing-vertical: 0.5rem; --pico-form-element-spacing-horizontal: 0.7rem; }
  body { padding: 0.75rem 1rem 3rem; }
  main.container { max-width: 880px; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
  header h2 { margin: 0; font-size: 1.4rem; }
  header hgroup p { margin: 0; }
  .toolbar { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin: 0.75rem 0; }
  .toolbar > .grow { flex: 1; }
  input, select, textarea, button { margin-bottom: 0; }
  label { display: block; margin: 0; font-size: 0.85em; color: var(--pico-muted-color); }
  label > input, label > select, label > textarea { margin-top: 0.2rem; }
  h5 { font-size: 0.95rem; }

  details.party { margin: 0.5rem 0; border: 1px solid var(--pico-muted-border-color); border-radius: var(--pico-border-radius); overflow: hidden; background: var(--pico-card-background-color); }
  details.party > summary {
    cursor: pointer;
    padding: 0.55rem 2.25rem 0.55rem 0.85rem;
    background: var(--pico-card-sectioning-background-color);
    list-style: none;
    position: relative;
    background-image: none;
  }
  details.party > summary::-webkit-details-marker,
  details.party > summary::marker { display: none; content: ''; }
  details.party > summary::after {
    content: '';
    position: absolute;
    top: 50%;
    right: 0.85rem;
    width: 0.55rem;
    height: 0.55rem;
    border-right: 2px solid var(--pico-muted-color);
    border-bottom: 2px solid var(--pico-muted-color);
    transform: translateY(-75%) rotate(45deg);
    transition: transform 0.15s ease;
  }
  details.party[open] > summary::after { transform: translateY(-25%) rotate(-135deg); }
  details.party[open] > summary { border-bottom: 1px solid var(--pico-muted-border-color); }
  .summary-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .summary-row .name { font-weight: 600; }
  .summary-row .meta { color: var(--pico-muted-color); font-size: 0.85em; }
  .pill { display: inline-block; padding: 0.05rem 0.55rem; border-radius: 999px; font-size: 0.75em; font-weight: 600; line-height: 1.5; }
  .pill-open   { background: #d1fae5; color: #065f46; }
  .pill-full   { background: #fef3c7; color: #92400e; }
  .pill-closed { background: #fee2e2; color: #991b1b; }
  .body { padding: 0.85rem; }
  .body h5 { margin-top: 1rem; margin-bottom: 0.45rem; }
  .body h5:first-of-type { margin-top: 0; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  @media (max-width: 640px) { .grid-2 { grid-template-columns: 1fr; } }
  .grid-2 .span-2 { grid-column: 1 / -1; }
  .row { display: flex; gap: 0.5rem; align-items: center; padding: 0.3rem 0; border-bottom: 1px solid var(--pico-muted-border-color); flex-wrap: wrap; }
  .row:last-child { border-bottom: none; }
  .row .who { flex: 1; min-width: 11rem; font-size: 0.92em; }
  .row .who .crown { color: #d4a017; margin-right: 0.25rem; }
  .row .who .uid { color: var(--pico-muted-color); font-size: 0.8em; font-family: var(--pico-font-family-monospace); }
  button.tiny { font-size: 0.8em; padding: 0.2rem 0.6rem; margin: 0; line-height: 1.2; }
  button.danger { --pico-background-color: #dc2626; --pico-border-color: #dc2626; --pico-color: white; }
  button.danger:hover { --pico-background-color: #b91c1c; --pico-border-color: #b91c1c; }
  textarea.bans { min-height: 6rem; font-family: var(--pico-font-family-monospace); font-size: 0.9em; }
  .muted { color: var(--pico-muted-color); font-size: 0.85em; }
  #toast { position: fixed; bottom: 1.25rem; right: 1.25rem; padding: 0.6rem 1rem; border-radius: 0.4rem; background: var(--pico-card-background-color); box-shadow: var(--pico-card-box-shadow); z-index: 10; }
  #toast.err { background: #fee2e2; color: #991b1b; }
  .empty { padding: 2.5rem 1rem; text-align: center; color: var(--pico-muted-color); }
  .activity { margin: -0.25rem 0 0.85rem; font-size: 0.82em; }
  .activity span[title] { cursor: help; border-bottom: 1px dotted var(--pico-muted-border-color); }
</style>
</head>
<body>
<main class="container">
  <header>
    <hgroup>
      <h2>PartyBot Admin</h2>
      <p id="subtitle" class="muted">Loading…</p>
    </hgroup>
    <div>
      <span id="who" class="muted"></span>
      <a href="?" id="change-guild" style="display:none; margin-left: 1rem">change guild</a>
    </div>
  </header>
  <div id="content"></div>
</main>
<div id="toast" hidden></div>

<script>
const GAMES = ${GAMES_JSON}
const params = new URLSearchParams(location.search)
const guildId = params.get('guild')
const $ = (sel, root = document) => root.querySelector(sel)
const subtitle = $('#subtitle')
const content  = $('#content')
const toastEl  = $('#toast')

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

api('/me').then(r => { if (r?.email) $('#who').textContent = r.email }).catch(() => {})

if (!guildId) {
  showGuildPicker()
} else {
  subtitle.textContent = 'Guild: ' + guildId
  $('#change-guild').style.display = ''
  loadAll()
}

function showGuildPicker() {
  subtitle.textContent = 'Enter the guild ID to manage'
  const input = el('input', { type: 'text', name: 'guild', required: true, placeholder: '1234567890123', autofocus: true })
  const form = el('form', {},
    el('label', {}, 'Guild ID', input),
    el('button', { type: 'submit' }, 'Open'),
  )
  form.addEventListener('submit', e => {
    e.preventDefault()
    const id = input.value.trim()
    if (id) location.search = '?guild=' + encodeURIComponent(id)
  })
  content.replaceChildren(form)
}

let voiceChannels = []

function snapshotOpenParties() {
  return new Set(
    [...content.querySelectorAll('details.party[open]')].map(d => d.dataset.partyId).filter(Boolean)
  )
}

async function loadAll() {
  const openIds = snapshotOpenParties()
  try {
    const [parties, channels] = await Promise.all([api('/parties'), api('/channels')])
    voiceChannels = channels
    renderParties(parties, openIds)
  } catch (e) {
    content.replaceChildren(el('article', {}, 'Error: ' + e.message))
  }
}

function renderParties(parties, openIds = new Set()) {
  const toolbar = el('div', { class: 'toolbar' },
    el('span', { class: 'muted grow' }, parties.length + ' part' + (parties.length === 1 ? 'y' : 'ies')),
    el('button', { class: 'secondary tiny', onclick: loadAll }, 'Refresh'),
    el('button', { class: 'danger tiny', disabled: parties.length === 0, onclick: async () => {
      if (!confirm('Disband ALL parties in this guild? This cannot be undone.')) return
      try { await api('/clear', { method: 'POST' }); toast('Cleared'); loadAll() }
      catch (e) { toast(e.message, 'err') }
    } }, 'Clear all'),
  )
  if (parties.length === 0) {
    content.replaceChildren(toolbar, el('div', { class: 'empty' }, 'No active parties.'))
    return
  }
  content.replaceChildren(toolbar, ...parties.map(p => renderParty(p, openIds.has(p.id))))
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
    m.userId !== p.ownerId ? el('button', { class: 'tiny secondary', onclick: async () => {
      if (!confirm('Promote ' + m.displayName + ' to owner of ' + p.name + '?')) return
      try { await api('/parties/' + p.id + '/members/' + m.userId + '/promote', { method: 'POST' }); toast('Promoted'); loadAll() }
      catch (e) { toast(e.message, 'err') }
    } }, 'Promote') : null,
    m.userId !== p.ownerId ? el('button', { class: 'tiny danger', onclick: async () => {
      try { await api('/parties/' + p.id + '/members/' + m.userId, { method: 'DELETE' }); toast('Removed'); loadAll() }
      catch (e) { toast(e.message, 'err') }
    } }, 'Remove') : el('span', { class: 'muted' }, 'owner'),
  )
}

function queueLine(p, q) {
  return el('div', { class: 'row' },
    el('div', { class: 'who' },
      el('strong', {}, q.displayName),
      q.ign ? ' (' + q.ign + ')' : null,
      ' ',
      el('span', { class: 'uid' }, q.userId),
    ),
    el('button', { class: 'tiny', onclick: async () => {
      try { await api('/parties/' + p.id + '/members/' + q.userId + '/approve', { method: 'POST' }); toast('Approved'); loadAll() }
      catch (e) { toast(e.message, 'err') }
    } }, 'Approve'),
    el('button', { class: 'tiny secondary', onclick: async () => {
      try { await api('/parties/' + p.id + '/queue/' + q.userId, { method: 'DELETE' }); toast('Denied'); loadAll() }
      catch (e) { toast(e.message, 'err') }
    } }, 'Deny'),
  )
}

const HOUR_MS = 60 * 60 * 1000
function inactivityMs(p) {
  if (p.members.length >= p.maxSize || p.queue.length > 0) return 12 * HOUR_MS
  if (p.members.length > 1) return 6 * HOUR_MS
  return 2 * HOUR_MS
}
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

function renderParty(p, isOpen = false) {
  const last = p.lastActivityAt ?? p.createdAt
  const deadline = last + inactivityMs(p)
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

  // Settings form
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
        ...voiceChannels.map(c => el('option', { value: c.id, selected: c.id === p.voiceChannelId ? 'selected' : null }, '#' + c.name)),
        ...(p.voiceChannelId && !voiceChannels.find(c => c.id === p.voiceChannelId)
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
      toast('Saved'); loadAll()
    } catch (err) { toast(err.message, 'err') }
  }

  const settingsActions = el('div', { class: 'toolbar' },
    el('button', { type: 'button', onclick: saveSettings }, 'Save'),
    el('button', { type: 'button', class: 'secondary', onclick: async () => {
      try {
        await api('/parties/' + p.id + (p.isClosed ? '/open' : '/close'), { method: 'POST' })
        toast(p.isClosed ? 'Opened' : 'Closed'); loadAll()
      } catch (err) { toast(err.message, 'err') }
    } }, p.isClosed ? 'Open party' : 'Close party'),
    el('span', { class: 'grow' }),
    el('button', { type: 'button', class: 'danger', onclick: async () => {
      if (!confirm('Disband "' + p.name + '"?')) return
      try { await api('/parties/' + p.id, { method: 'DELETE' }); toast('Disbanded'); loadAll() }
      catch (err) { toast(err.message, 'err') }
    } }, 'Disband'),
  )

  // Add member
  const addInput = el('input', { name: 'userId', placeholder: 'Discord user ID', required: true })
  const addForm = el('form', { class: 'toolbar' },
    el('div', { class: 'grow' }, addInput),
    el('button', { type: 'submit' }, 'Add'),
  )
  addForm.addEventListener('submit', async e => {
    e.preventDefault()
    const userId = addInput.value.trim()
    if (!userId) return
    try { await api('/parties/' + p.id + '/members', { method: 'POST', body: JSON.stringify({ userId }) }); toast('Added'); loadAll() }
    catch (err) { toast(err.message, 'err') }
  })

  // Banlist
  const banText = (p.banlist && p.banlist.source) ? p.banlist.source.join('\\n') : ''
  const banArea = el('textarea', { name: 'banlist', class: 'bans', placeholder: 'one champion per line' }, banText)
  const banActions = el('div', { class: 'toolbar' },
    el('button', { type: 'button', onclick: async () => {
      try { await api('/parties/' + p.id + '/banlist', { method: 'PATCH', body: JSON.stringify({ banlist: banArea.value }) }); toast('Banlist saved'); loadAll() }
      catch (err) { toast(err.message, 'err') }
    } }, 'Save banlist'),
    el('button', { type: 'button', class: 'secondary', onclick: async () => {
      try { await api('/parties/' + p.id + '/banlist', { method: 'PATCH', body: JSON.stringify({ banlist: '' }) }); toast('Cleared'); loadAll() }
      catch (err) { toast(err.message, 'err') }
    } }, 'Clear'),
  )

  const body = el('div', { class: 'body' },
    el('div', { class: 'muted activity' },
      el('span', { title: fmtAbs(last) }, 'Last activity: ' + lastLabel),
      el('span', {}, ' · '),
      el('span', { title: fmtAbs(deadline) }, 'Auto-disband: ' + dueLabel),
    ),
    el('h5', {}, 'Settings'),
    settingsForm,
    settingsActions,
    el('h5', {}, 'Members (' + p.members.length + '/' + p.maxSize + ')'),
    ...p.members.map(m => memberLine(p, m)),
    p.queue.length > 0 ? el('h5', {}, 'Queue (' + p.queue.length + ')') : null,
    ...p.queue.map(q => queueLine(p, q)),
    el('h5', {}, 'Add member'),
    addForm,
    el('h5', {}, 'Banlist'),
    banArea,
    banActions,
  )

  return el('details', { class: 'party', 'data-party-id': p.id, open: isOpen ? 'open' : null }, summary, body)
}
</script>
</body>
</html>`
