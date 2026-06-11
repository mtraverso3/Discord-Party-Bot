import { describe, expect, it } from 'vitest'
import { crossReference, ignMatches, parseRiotId, type LobbyEntry, type PartyEntry } from '../src/shared/match'

describe('parseRiotId', () => {
  it('splits name and tagline', () => {
    expect(parseRiotId('Faker#KR1')).toEqual({ name: 'Faker', tag: 'KR1' })
    expect(parseRiotId('  Hide on bush # KR1 ')).toEqual({ name: 'Hide on bush', tag: 'KR1' })
  })

  it('accepts a missing tagline', () => {
    expect(parseRiotId('Faker')).toEqual({ name: 'Faker', tag: null })
    expect(parseRiotId('Faker#')).toEqual({ name: 'Faker', tag: null })
  })

  it('rejects empty input', () => {
    expect(parseRiotId('')).toBeNull()
    expect(parseRiotId('   ')).toBeNull()
    expect(parseRiotId(null)).toBeNull()
    expect(parseRiotId('#NA1')).toBeNull()
  })
})

describe('ignMatches', () => {
  it('is case-insensitive and whitespace-tolerant', () => {
    expect(ignMatches('hide  on Bush#kr1', 'Hide on bush', 'KR1')).toBe(true)
  })

  it('matches on name alone when the IGN has no tagline', () => {
    expect(ignMatches('Faker', 'Faker', 'KR1')).toBe(true)
    expect(ignMatches('Faker#EUW', 'Faker', 'KR1')).toBe(false)
  })

  it('rejects different names', () => {
    expect(ignMatches('NotFaker#KR1', 'Faker', 'KR1')).toBe(false)
    expect(ignMatches(null, 'Faker', 'KR1')).toBe(false)
  })
})

describe('crossReference', () => {
  const party: PartyEntry[] = [
    { userId: 'me', displayName: 'Me', ign: null, puuid: null },
    { userId: 'u1', displayName: 'Alice', ign: 'AliceIGN#NA1', puuid: 'puuid-alice' },
    { userId: 'u2', displayName: 'Bob', ign: 'BobIGN#NA1', puuid: null },
    { userId: 'u3', displayName: 'Carol', ign: null, puuid: null },
  ]

  const lobby: LobbyEntry[] = [
    { puuid: 'puuid-me', gameName: 'MyAccount', tagLine: 'NA1', isLeader: true },
    { puuid: 'puuid-alice', gameName: 'Renamed Alice', tagLine: 'NA1', isLeader: false },
    { puuid: 'puuid-bob', gameName: 'bobign', tagLine: 'na1', isLeader: false },
    { puuid: 'puuid-snipe', gameName: 'Sniper', tagLine: 'EUW', isLeader: false },
  ]

  it('matches self by puuid, members by puuid or IGN, and flags intruders', () => {
    const view = crossReference(party, lobby, 'me', 'puuid-me')
    expect(view.rows.map(r => r.status)).toEqual(['you', 'party', 'party', 'intruder'])
    expect(view.rows[1]!.displayName).toBe('Alice')   // puuid beats the renamed Riot ID
    expect(view.rows[2]!.displayName).toBe('Bob')     // IGN string match
    expect(view.intruders).toBe(1)
    expect(view.missing).toEqual([{ displayName: 'Carol', ign: null }])
  })

  it('reports everyone missing when the lobby is empty', () => {
    const view = crossReference(party, [], 'me', 'puuid-me')
    expect(view.rows).toEqual([])
    expect(view.missing).toHaveLength(4)
    expect(view.intruders).toBe(0)
  })
})
