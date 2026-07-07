// Pure logic for Riot ID handling and party/lobby cross-referencing.
// Kept dependency-free so it is unit-testable outside Electron.

import type { LobbyRow, LobbyView, TaggedPlayer } from './types'

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

/** Case-insensitive, whitespace-collapsed comparison key for Riot names. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
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
      return { riotId, isLeader: l.isLeader, status: 'you', displayName: null, tag: null }
    }
    const member = party.find(p =>
      (p.puuid !== null && p.puuid === l.puuid) || ignMatches(p.ign, l.gameName, l.tagLine),
    )
    if (member) {
      matched.add(member.userId)
      return { riotId, isLeader: l.isLeader, status: 'party', displayName: member.displayName, tag: null }
    }
    const taggedPlayer = tagged.find(t => ignMatches(t.riotId, l.gameName, l.tagLine))
    if (taggedPlayer) {
      return { riotId, isLeader: l.isLeader, status: 'tagged', displayName: null, tag: taggedPlayer.tag }
    }
    return { riotId, isLeader: l.isLeader, status: 'intruder', displayName: null, tag: null }
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
