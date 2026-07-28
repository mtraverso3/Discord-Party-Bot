// Pure logic for Riot ID handling and party/lobby cross-referencing.
// Kept dependency-free so it is unit-testable outside Electron.

import type { KnownPlayer, LobbyRow, LobbyView, TaggedPlayer } from './types'

export interface ParsedRiotId {
  name: string
  tag: string | null
}

/** Parse a user-entered IGN like "Faker#KR1" (tagline optional). */
export function parseRiotId(raw: string | null | undefined): ParsedRiotId | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  const hash = s.indexOf('#')
  if (hash === -1) return { name: s, tag: null }
  const name = s.slice(0, hash).trim()
  const tag = s.slice(hash + 1).trim()
  if (!name) return null
  return { name, tag: tag || null }
}

// Characters that can sit inside a Riot ID — or a hand-typed IGN pasted out of
// one — without being visible: zero-width spaces/joiners, the directional
// marks, the BOM, and the soft hyphen. Two names that look identical on screen
// have to compare equal, so these are dropped rather than compared.
const INVISIBLE = /[\u00ad\u180e\u200b-\u200f\u2060\ufeff]/g

/** Case-insensitive, whitespace-collapsed comparison key for Riot names.
 *  NFKC-folded and stripped of invisible characters so two IGNs that render the
 *  same always match — otherwise a member is silently flagged as an intruder. */
export function normalizeName(name: string): string {
  return name.normalize('NFKC').replace(INVISIBLE, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function formatRiotId(gameName: string, tagLine: string): string {
  return tagLine ? `${gameName}#${tagLine}` : gameName
}

/** Whether a party member's IGN refers to a lobby member's Riot ID.
 *  A missing tagline in the IGN matches on name alone. */
export function ignMatches(ign: string | null | undefined, gameName: string, tagLine: string): boolean {
  const parsed = parseRiotId(ign)
  if (!parsed) return false
  if (normalizeName(parsed.name) !== normalizeName(gameName)) return false
  return parsed.tag === null || normalizeName(parsed.tag) === normalizeName(tagLine)
}

export interface PartyEntry {
  userId: string
  displayName: string
  ign: string | null
  puuid: string | null  // resolved via LCU alias lookup, when available
}

export interface LobbyEntry {
  puuid: string
  gameName: string
  tagLine: string
  isLeader: boolean
}

/** Compare the live League lobby against the Discord party roster.
 *  Matching precedence per lobby slot: self (by puuid) > party member by
 *  resolved puuid > party member by IGN string > user-tagged player > intruder. */
export function crossReference(
  party: PartyEntry[],
  lobby: LobbyEntry[],
  selfUserId: string | null,
  selfPuuid: string | null,
  tagged: TaggedPlayer[] = [],
): LobbyView {
  const matched = new Set<string>()

  const rows: LobbyRow[] = lobby.map((l) => {
    const riotId = formatRiotId(l.gameName, l.tagLine)
    if (selfPuuid && l.puuid === selfPuuid) {
      if (selfUserId) matched.add(selfUserId)
      return { riotId, isLeader: l.isLeader, status: 'you', userId: selfUserId, displayName: null, tag: null, known: null }
    }
    const member = party.find(p =>
      (p.puuid !== null && p.puuid === l.puuid) || ignMatches(p.ign, l.gameName, l.tagLine),
    )
    if (member) {
      matched.add(member.userId)
      return {
        riotId, isLeader: l.isLeader, status: 'party',
        userId: member.userId, displayName: member.displayName, tag: null, known: null,
      }
    }
    const taggedPlayer = tagged.find(t => ignMatches(t.riotId, l.gameName, l.tagLine))
    if (taggedPlayer) {
      return { riotId, isLeader: l.isLeader, status: 'tagged', userId: null, displayName: null, tag: taggedPlayer.tag, known: null }
    }
    return { riotId, isLeader: l.isLeader, status: 'intruder', userId: null, displayName: null, tag: null, known: null }
  })

  const missing = party
    .filter(p => !matched.has(p.userId))
    .map(p => ({ displayName: p.displayName, ign: p.ign }))

  return {
    exists: true,
    rows,
    missing,
    intruders: rows.filter(r => r.status === 'intruder').length,
  }
}

/**
 * Fold the bot's "who owns this Riot ID" lookup back into a cross-referenced
 * view.
 *
 * A lobby slot the bot resolves to someone already in the party is not an
 * intruder — it's a member playing on a Riot ID the party's IGN snapshot
 * doesn't know about (they renamed the account, changed their tagline, or
 * registered the IGN under a different game). Identity, not a snapshot string,
 * decides membership, so those rows are promoted to 'party' and the missing
 * list and intruder count are recomputed from what actually got claimed.
 *
 * Rows the user has manually tagged are left alone — that label is a deliberate
 * choice and doesn't raise the "not in the party" alarm either way.
 */
export function reconcileKnownPlayers(
  view: LobbyView,
  party: PartyEntry[],
  known: Record<string, KnownPlayer | null>,
): LobbyView {
  const byUserId = new Map(party.map(p => [p.userId, p]))

  const rows: LobbyRow[] = view.rows.map((row) => {
    if (row.status !== 'intruder') return row
    const hit = known[row.riotId] ?? null
    const member = hit?.inParty ? byUserId.get(hit.userId) : undefined
    if (member) {
      return { ...row, status: 'party', userId: member.userId, displayName: member.displayName, known: null }
    }
    return { ...row, known: hit }
  })

  const claimed = new Set(rows.map(r => r.userId).filter((id): id is string => id !== null))

  return {
    ...view,
    rows,
    missing: party.filter(p => !claimed.has(p.userId)).map(p => ({ displayName: p.displayName, ign: p.ign })),
    intruders: rows.filter(r => r.status === 'intruder').length,
  }
}
