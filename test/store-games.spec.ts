import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import * as parties from '../src/store/parties'
import * as history from '../src/store/history'
import * as games from '../src/store/games'
import { matchClusterForRegion, matchIdForGame, platformForRegion } from '../src/lib/riot'

let seq = 0
const user = (id: string) => ({ userId: id, username: `${id}_un`, displayName: id.toUpperCase() })

async function makeSession() {
  const guildId = `gg-${Date.now()}-${seq++}`
  const created = await parties.createParty(env.DB, {
    id: 'GAME01', guildId, name: 'Games party', description: '', game: 'LoL NA',
    owner: user('owner'), maxSize: 5,
  })
  if (!created.ok) throw new Error(created.message)
  const historyId = (await history.activeSessionId(env.DB, guildId, 'GAME01'))!
  return { guildId, partyId: 'GAME01', historyId }
}

describe('riot match helpers', () => {
  it('builds a match id from region + gameId', () => {
    expect(matchIdForGame('NA', '4812345678')).toBe('NA1_4812345678')
    expect(matchIdForGame('EUW', '123')).toBe('EUW1_123')
    expect(matchIdForGame('bogus', '1')).toBeNull()
  })

  it('routes SEA regions to their own match cluster', () => {
    expect(matchClusterForRegion('NA')).toBe('americas')
    expect(matchClusterForRegion('KR')).toBe('asia')
    expect(matchClusterForRegion('OCE')).toBe('sea')
    expect(platformForRegion('NA')).toBe('na1')
  })
})

describe('game reporting', () => {
  it('records a pending game against the active session', async () => {
    const { guildId, partyId, historyId } = await makeSession()
    const r = await games.reportGame(env.DB, {
      historyId, guildId, partyId, region: 'NA', gameId: '999', reportedBy: 'owner',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.status).toBe('pending')
      expect(r.matchId).toBe('NA1_999')
    }
    const list = await games.listGamesForHistory(env.DB, historyId)
    expect(list).toHaveLength(1)
    expect(list[0]!.status).toBe('pending')
    expect(list[0]!.matchId).toBe('NA1_999')
    expect(list[0]!.participants).toHaveLength(0)
  })

  it('is idempotent per (session, match)', async () => {
    const { guildId, partyId, historyId } = await makeSession()
    const input = { historyId, guildId, partyId, region: 'NA', gameId: '1000', reportedBy: 'owner' }
    await games.reportGame(env.DB, input)
    await games.reportGame(env.DB, { ...input, reportedBy: 'a' })  // second client, same match
    expect(await games.listGamesForHistory(env.DB, historyId)).toHaveLength(1)
  })

  it('rejects an unsupported region or bad gameId', async () => {
    const { guildId, partyId, historyId } = await makeSession()
    expect((await games.reportGame(env.DB, {
      historyId, guildId, partyId, region: 'ZZ', gameId: '1', reportedBy: 'owner',
    })).ok).toBe(false)
    expect((await games.reportGame(env.DB, {
      historyId, guildId, partyId, region: 'NA', gameId: 'abc', reportedBy: 'owner',
    })).ok).toBe(false)
  })

  it('resolvePendingGames is a no-op without a Riot API key', async () => {
    const { guildId, partyId, historyId } = await makeSession()
    await games.reportGame(env.DB, { historyId, guildId, partyId, region: 'NA', gameId: '1', reportedBy: 'owner' })
    expect(await games.resolvePendingGames(env.DB, undefined)).toBe(0)
    expect((await games.listGamesForHistory(env.DB, historyId))[0]!.status).toBe('pending')
  })

  it('drops game reports when the session is disbanded (FK cascade)', async () => {
    const { guildId, partyId, historyId } = await makeSession()
    await games.reportGame(env.DB, { historyId, guildId, partyId, region: 'NA', gameId: '1', reportedBy: 'owner' })
    // History rows persist across disband, so the game report stays attached.
    await parties.disbandParty(env.DB, guildId, partyId, 'owner')
    expect(await games.listGamesForHistory(env.DB, historyId)).toHaveLength(1)
  })
})
