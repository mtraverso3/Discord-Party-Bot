import { describe, expect, it } from 'vitest'
import {
  crossReference, ignMatches, parseRiotId, reconcileKnownPlayers,
  type LobbyEntry, type PartyEntry,
} from '../src/shared/match'
import type { KnownPlayer } from '../src/shared/types'

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

  // Spelled out by code point rather than pasted in: a raw zero-width space
  // in a source file is impossible to review, and the point of the test is
  // exactly that these are invisible.
  const ZWSP = String.fromCharCode(0x200b)
  const SOFT_HYPHEN = String.fromCharCode(0x00ad)
  const BOM = String.fromCharCode(0xfeff)
  const NBSP = String.fromCharCode(0x00a0)
  const COMBINING_ACUTE = String.fromCharCode(0x0301)

  it('ignores invisible characters that make identical-looking IGNs differ', () => {
    expect(ignMatches(`Something73${ZWSP}#NA1`, 'Something73', 'NA1')).toBe(true)
    expect(ignMatches(`Some${SOFT_HYPHEN}thing73#NA1`, 'Something73', 'NA1')).toBe(true)
    expect(ignMatches(`Something73#${BOM}NA1`, 'Something73', 'NA1')).toBe(true)
    expect(ignMatches(`Something73${NBSP}#NA1`, 'Something73', 'NA1')).toBe(true)
  })

  it('folds decomposed accents onto their composed form', () => {
    // Riot IDs allow accented names, and the two encodings look identical.
    expect(ignMatches(`Cafe${COMBINING_ACUTE}#NA1`, `Cafe${COMBINING_ACUTE}`.normalize('NFC'), 'NA1')).toBe(true)
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

  it('carries the Discord id on matched rows', () => {
    const view = crossReference(party, lobby, 'me', 'puuid-me')
    expect(view.rows.map(r => r.userId)).toEqual(['me', 'u1', 'u2', null])
  })

  it('reports everyone missing when the lobby is empty', () => {
    const view = crossReference(party, [], 'me', 'puuid-me')
    expect(view.rows).toEqual([])
    expect(view.missing).toHaveLength(4)
    expect(view.intruders).toBe(0)
  })

  it('excludes tagged players from the intruder count and shows their label', () => {
    const view = crossReference(party, lobby, 'me', 'puuid-me', [{ riotId: 'Sniper#EUW', tag: 'smurf' }])
    expect(view.rows.map(r => r.status)).toEqual(['you', 'party', 'party', 'tagged'])
    expect(view.rows[3]).toMatchObject({ riotId: 'Sniper#EUW', status: 'tagged', tag: 'smurf' })
    expect(view.intruders).toBe(0)
  })

  it('matches a tagged player by name alone, ignoring tagline', () => {
    const view = crossReference(party, lobby, 'me', 'puuid-me', [{ riotId: 'Sniper', tag: 'coach' }])
    expect(view.rows[3]).toMatchObject({ status: 'tagged', tag: 'coach' })
  })

  it('still flags as intruder when no tag matches', () => {
    const view = crossReference(party, lobby, 'me', 'puuid-me', [{ riotId: 'SomeoneElse#NA1', tag: 'friend' }])
    expect(view.rows[3]).toMatchObject({ status: 'intruder', tag: null })
    expect(view.intruders).toBe(1)
  })
})

describe('reconcileKnownPlayers', () => {
  // Carol is in the party but her roster IGN is stale — she's playing on
  // "Renamed Carol#NA1", which neither her IGN string nor a puuid resolved from
  // it can match, so the raw cross-reference calls her an intruder.
  const party: PartyEntry[] = [
    { userId: 'me', displayName: 'Me', ign: 'MyAccount#NA1', puuid: 'puuid-me' },
    { userId: 'u3', displayName: 'Carol', ign: 'OldCarol#NA1', puuid: null },
  ]

  const lobby: LobbyEntry[] = [
    { puuid: 'puuid-me', gameName: 'MyAccount', tagLine: 'NA1', isLeader: true },
    { puuid: 'puuid-carol', gameName: 'Renamed Carol', tagLine: 'NA1', isLeader: false },
    { puuid: 'puuid-snipe', gameName: 'Sniper', tagLine: 'EUW', isLeader: false },
  ]

  const base = () => crossReference(party, lobby, 'me', 'puuid-me')

  const hit = (userId: string, displayName: string, inParty: boolean): KnownPlayer =>
    ({ userId, displayName, inParty })

  it('promotes a member the bot recognizes out of the intruder list', () => {
    const before = base()
    expect(before.rows[1]).toMatchObject({ status: 'intruder' })
    expect(before.intruders).toBe(2)

    const view = reconcileKnownPlayers(before, party, {
      'Renamed Carol#NA1': hit('u3', 'Carol', true),
      'Sniper#EUW': null,
    })
    expect(view.rows[1]).toMatchObject({
      status: 'party', userId: 'u3', displayName: 'Carol', known: null,
    })
    expect(view.intruders).toBe(1)          // only the actual stranger is left
    expect(view.missing).toEqual([])        // Carol is no longer reported absent
  })

  it('annotates a recognized non-member without clearing the intruder flag', () => {
    const view = reconcileKnownPlayers(base(), party, {
      'Renamed Carol#NA1': null,
      'Sniper#EUW': hit('u9', 'Mallory', false),
    })
    expect(view.rows[2]).toMatchObject({ status: 'intruder', userId: null })
    expect(view.rows[2]!.known).toEqual(hit('u9', 'Mallory', false))
    expect(view.intruders).toBe(2)
  })

  it('ignores a hit for someone who is not on the roster', () => {
    // Stale answer for a member who left between the lookup and the response.
    const view = reconcileKnownPlayers(base(), party, {
      'Renamed Carol#NA1': hit('gone', 'Ghost', true),
    })
    expect(view.rows[1]).toMatchObject({ status: 'intruder' })
    expect(view.intruders).toBe(2)
  })

  it('leaves you, matched members and tagged rows untouched', () => {
    const tagged = crossReference(party, lobby, 'me', 'puuid-me', [{ riotId: 'Sniper#EUW', tag: 'coach' }])
    const view = reconcileKnownPlayers(tagged, party, { 'Sniper#EUW': hit('u3', 'Carol', true) })
    expect(view.rows[0]).toMatchObject({ status: 'you', userId: 'me' })
    expect(view.rows[2]).toMatchObject({ status: 'tagged', tag: 'coach', userId: null })
  })

  it('is a no-op when nothing is recognized', () => {
    const before = base()
    expect(reconcileKnownPlayers(before, party, {})).toEqual(before)
  })
})
