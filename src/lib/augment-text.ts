// Hover text for Arena and ARAM Mayhem augments, keyed by the augment id
// Match-v5 reports. The admin dashboard shows it on augment icons.
//
// Augment descriptions aren't in Data Dragon. CommunityDragon's Arena export
// has full descriptions with their numbers for most Arena augments; the rest
// come from the game's string table, matched by the augment's name id. That
// table is ~32 MB of JSON, so it is read as a stream and only the augment
// strings (a few hundred KB) are kept; parsing it whole could approach the
// Worker's memory limit. The cron refreshes the result daily into D1.

const CDRAGON = 'https://raw.communitydragon.org/latest'
const STATE_KEY = 'augment-text'
export const AUGMENT_TEXT_MAX_AGE_MS = 24 * 60 * 60 * 1000

// String table keys worth keeping: augment text, and the shared keywords it
// references through {{...}}.
const KEEP_KEY = /^(?:kiwi|cherry|aram|item_keyword)_/

interface CatalogAugment { id: number; augmentNameId: string }
interface Calculation { mFormulaParts?: { __type: string; mDataValue?: string }[]; mDisplayAsPercent?: boolean }
export interface ArenaAugment {
  id: number
  desc?: string
  dataValues?: Record<string, number[]>
  calculations?: Record<string, Calculation>
}

// ── Streaming string table reader ────────────────────────────────────────────

/**
 * Always goes through JSON.parse, even without escapes: that builds a new
 * string. A plain slice would keep the whole decoded chunk it came from alive,
 * and the kept entries are spread across the file, pinning most of it.
 */
function decodeJsonString(raw: string): string {
  return JSON.parse(`"${raw}"`) as string
}

/**
 * Reads `{"entries": {"key": "value", ...}, ...}` from a stream and returns the
 * entries whose key passes `keep`, without holding the whole document. Values
 * of skipped keys are scanned past, never accumulated.
 */
export async function readStringTable(
  body: ReadableStream<Uint8Array>, keep: (key: string) => boolean,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const decoder = new TextDecoder()
  let depth = 0
  let inString = false
  let escaping = false
  let expectKey = false
  let role: 'key' | 'value' | null = null
  let collecting = false
  let buf = ''
  let key = ''

  const finishString = () => {
    if (role === 'key') key = decodeJsonString(buf)
    else if (role === 'value' && collecting) out[key] = decodeJsonString(buf)
    buf = ''
  }

  const reader = body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true })
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]!
      if (inString) {
        if (escaping) { if (collecting) buf += ch; escaping = false; continue }
        if (ch === '\\') { if (collecting) buf += ch; escaping = true; continue }
        if (ch === '"') { inString = false; finishString(); continue }
        // Jump to the next quote or backslash instead of walking every character.
        const q = chunk.indexOf('"', i)
        const b = chunk.indexOf('\\', i)
        const end = q === -1 ? (b === -1 ? chunk.length : b) : (b === -1 ? q : Math.min(q, b))
        if (collecting) buf += chunk.slice(i, end)
        i = end - 1
        continue
      }
      if (ch === '"') {
        inString = true
        // Only the entries object (depth 2) holds the key/value pairs we want.
        role = depth === 2 ? (expectKey ? 'key' : 'value') : null
        collecting = role === 'key' || (role === 'value' && keep(key))
      } else if (ch === '{') {
        depth++
        if (depth === 2) expectKey = true
      } else if (ch === '}') {
        depth--
      } else if (depth === 2 && ch === ':') {
        expectKey = false
      } else if (depth === 2 && ch === ',') {
        expectKey = true
      }
    }
    if (done) break
  }
  return out
}

// ── Building the text ────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  return String(Math.round(n * 10) / 10)
}

/**
 * Fills `@Name@` / `@Name*100@` placeholders from an augment's data values
 * (level-1 values) and simple calculations. Returns null if any is left over.
 */
function fillValues(text: string, aug: ArenaAugment | undefined): string | null {
  const values = new Map(Object.entries(aug?.dataValues ?? {}).map(([k, v]) => [k.toLowerCase(), v[1] ?? v[0] ?? 0]))
  const calcs = new Map(Object.entries(aug?.calculations ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
  let unresolved = false
  const filled = text.replace(/@([^@]+)@/g, (_, expr: string) => {
    const [name = '', factor] = expr.split('*')
    const key = name.toLowerCase()
    let value = values.get(key)
    if (value === undefined) {
      // A calculation made only of plain data values sums them.
      const calc = calcs.get(key)
      const parts = calc?.mFormulaParts ?? []
      if (calc && parts.length && parts.every(p => p.__type === 'NamedDataValueCalculationPart')) {
        value = parts.reduce((sum, p) => sum + (values.get((p.mDataValue ?? '').toLowerCase()) ?? NaN), 0)
        if (calc.mDisplayAsPercent) return Number.isNaN(value) ? '?' : `${formatNumber(value * 100)}%`
      }
    }
    if (value === undefined || Number.isNaN(value)) { unresolved = true; return '?' }
    return formatNumber(factor ? value * Number(factor) : value)
  })
  return unresolved ? null : filled
}

/** `{{Key}}` references point at other string table entries. */
function expandRefs(text: string, strings: Record<string, string>, depth = 0): string {
  return text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => {
    const ref = strings[key.toLowerCase()]
    return ref !== undefined && depth < 3 ? expandRefs(ref, strings, depth + 1) : ''
  })
}

function clean(text: string): string {
  return text
    .replace(/%i:[^%]+%\s*/g, '')        // inline stat icons
    .replace(/@[^@]+@/g, '?')            // values we couldn't work out
    .replace(/(<br\s*\/?>\s*)+$/i, '')   // trailing breaks
    .trim()
}

/** Augment id → description in League tooltip markup. Ids without any text are left out. */
export function buildAugmentText(
  catalog: CatalogAugment[], arena: ArenaAugment[], strings: Record<string, string>,
): Record<number, string> {
  const arenaById = new Map(arena.map(a => [a.id, a]))

  // String table keys look like kiwi_augment_<name>_tooltip or cherry_<name>_summary.
  const byStem = new Map<string, { tooltip?: string; summary?: string }>()
  for (const [key, value] of Object.entries(strings)) {
    const m = /^(?:kiwi|cherry|aram)_(?:augment_|aram_)?(.+)_(tooltip|summary)$/.exec(key)
    if (!m) continue
    const entry = byStem.get(m[1]!) ?? {}
    entry[m[2] as 'tooltip' | 'summary'] ??= value
    byStem.set(m[1]!, entry)
  }

  const out: Record<number, string> = {}
  for (const aug of catalog) {
    const fromArena = arenaById.get(aug.id)
    const nameId = aug.augmentNameId.toLowerCase()
    const stem = byStem.get(nameId) ?? byStem.get(nameId.split('_').slice(1).join('_'))

    // Prefer text whose numbers we can fill in, then text with no numbers at all.
    const candidates = [
      fromArena?.desc && fillValues(expandRefs(fromArena.desc, strings), fromArena),
      ...[stem?.tooltip, stem?.summary].map(t => t && fillValues(expandRefs(t, strings), fromArena)),
      stem?.summary && expandRefs(stem.summary, strings),
      stem?.tooltip && expandRefs(stem.tooltip, strings),
      fromArena?.desc && expandRefs(fromArena.desc, strings),
    ]
    const texts = candidates.map(t => (t ? clean(t) : '')).filter(Boolean)
    const text = texts.find(t => !t.includes('?')) ?? texts[0]
    if (text) out[aug.id] = text
  }
  return out
}

// ── Refresh and storage ──────────────────────────────────────────────────────

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.json() as Promise<T>
}

/** Fetches the sources, rebuilds the text and stores it. Returns how many augments got text. */
export async function refreshAugmentText(db: D1Database, now = Date.now()): Promise<number> {
  const [catalog, arena, table] = await Promise.all([
    getJson<CatalogAugment[]>(`${CDRAGON}/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json`),
    getJson<{ augments: ArenaAugment[] }>(`${CDRAGON}/cdragon/arena/en_us.json`),
    fetch(`${CDRAGON}/game/en_us/data/menu/en_us/lol.stringtable.json`),
  ])
  if (!table.ok || !table.body) throw new Error(`string table: ${table.status}`)
  const strings = await readStringTable(table.body, key => KEEP_KEY.test(key))

  const text = buildAugmentText(catalog, arena.augments, strings)
  const count = Object.keys(text).length
  // A broken upstream shouldn't wipe out text we already have.
  if (count === 0) throw new Error('no augment text built')
  await db.prepare(`
    INSERT INTO lol_data (key, value, updated_at) VALUES (?1, ?2, ?3)
    ON CONFLICT (key) DO UPDATE SET value = ?2, updated_at = ?3
  `).bind(STATE_KEY, JSON.stringify(text), now).run()
  return count
}

/** Cron: refresh when the stored text is missing or older than a day. */
export async function refreshAugmentTextIfStale(db: D1Database, now = Date.now()): Promise<number | null> {
  const row = await db.prepare('SELECT updated_at FROM lol_data WHERE key = ?1')
    .bind(STATE_KEY).first<{ updated_at: number }>()
  if (row && now - row.updated_at < AUGMENT_TEXT_MAX_AGE_MS) return null
  return refreshAugmentText(db, now)
}

/** The stored text as JSON (`{"<id>": "<markup>"}`), or null before the first refresh. */
export async function getAugmentTextJson(db: D1Database): Promise<{ json: string; updatedAt: number } | null> {
  const row = await db.prepare('SELECT value, updated_at FROM lol_data WHERE key = ?1')
    .bind(STATE_KEY).first<{ value: string; updated_at: number }>()
  return row ? { json: row.value, updatedAt: row.updated_at } : null
}
