import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('resolvePendingGames', () => {
  const original = globalThis.fetch
  let finished: Set<string>
  let calls: string[]

  beforeEach(() => {
    finished = new Set()
    calls = []
    globalThis.fetch = vi.fn(async (input: any) => {
      const matchId = String(input).split('/').pop()!
      calls.push(matchId)
      if (matchId.endsWith('_500')) return new Response('boom', { status: 500 })
      if (!finished.has(matchId)) return new Response('', { status: 404 })
      return Response.json({
        info: {
          queueId: 420, gameCreation: 1, gameDuration: 1800,
          participants: [{ puuid: 'p1', riotIdGameName: 'Me', riotIdTagline: 'NA1', championId: 1, championName: 'Annie', teamId: 100, win: true }],
        },
      })
    }) as any
  })
  afterEach(() => { globalThis.fetch = original })

  const report = (s: Awaited<ReturnType<typeof makeSession>>, gameId: string) =>
    games.reportGame(env.DB, { ...s, region: 'NA', gameId, reportedBy: 'owner' })
  const status = async (historyId: number) =>
    Object.fromEntries((await games.listGamesForHistory(env.DB, historyId)).map(g => [g.gameId, g]))

  it('resolves a finished match with its participants', async () => {
    const s = await makeSession()
    await report(s, '1')
    finished.add('NA1_1')
    expect(await games.resolvePendingGames(env.DB, 'key')).toBeGreaterThanOrEqual(1)
    const g = (await status(s.historyId))['1']!
    expect(g.status).toBe('resolved')
    expect(g.queueId).toBe(420)
    expect(g.participants).toEqual([
      { puuid: 'p1', riotId: 'Me#NA1', championId: 1, championName: 'Annie', teamId: 100, win: true, subteam: null, placement: null },
    ])
  })

  it('backs off a match that is not available yet', async () => {
    const s = await makeSession()
    await report(s, '2')
    const now = Date.now()
    await games.resolvePendingGames(env.DB, 'key', now)
    calls = []
    await games.resolvePendingGames(env.DB, 'key', now + 60_000)
    expect(calls).not.toContain('NA1_2')
    await games.resolvePendingGames(env.DB, 'key', now + games.retryDelayMs(1))
    expect(calls).toContain('NA1_2')
    expect((await status(s.historyId))['2']!.status).toBe('pending')
  })

  it("doesn't let unresolvable reports starve newer ones", async () => {
    const s = await makeSession()
    for (let i = 0; i < 25; i++) await report(s, `${100 + i}`)
    await report(s, '999')
    finished.add('NA1_999')
    const now = Date.now()
    await games.resolvePendingGames(env.DB, 'key', now)
    await games.resolvePendingGames(env.DB, 'key', now)
    expect((await status(s.historyId))['999']!.status).toBe('resolved')
  })

  it('records upstream errors and gives up after a day', async () => {
    const s = await makeSession()
    await report(s, '500')
    const now = Date.now()
    await games.resolvePendingGames(env.DB, 'key', now)
    expect((await status(s.historyId))['500']!.error).toContain('500')
    // Earlier tests' pending reports share the batch, so sweep until it drains.
    for (let i = 0; i < 5; i++) await games.resolvePendingGames(env.DB, 'key', now + 25 * 60 * 60 * 1000)
    expect((await status(s.historyId))['500']!.status).toBe('failed')
  })

  it('doubles the delay up to a cap', () => {
    expect(games.retryDelayMs(2)).toBe(2 * games.retryDelayMs(1))
    expect(games.retryDelayMs(50)).toBe(games.retryDelayMs(10))
  })
})

describe('listGamesForUser', () => {
  it("returns games from the user's sessions with their participants", async () => {
    const mine = await makeSession()
    await parties.joinParty(env.DB, mine.guildId, mine.partyId, user('player'))
    await games.reportGame(env.DB, { ...mine, region: 'NA', gameId: '42', reportedBy: 'owner' })
    const [row] = await games.listGamesForHistory(env.DB, mine.historyId)
    await env.DB.prepare(`
      INSERT INTO party_game_participants (game_row_id, puuid, riot_id, champion_id, champion_name, team_id, win)
      VALUES (?1, 'p1', 'Player#NA1', 1, 'Annie', 100, 1)
    `).bind(row!.id).run()

    const other = await makeSession()
    await games.reportGame(env.DB, { ...other, guildId: mine.guildId, region: 'NA', gameId: '43', reportedBy: 'owner' })

    const list = await games.listGamesForUser(env.DB, mine.guildId, 'player')
    expect(list.map(g => g.matchId)).toEqual(['NA1_42'])
    expect(list[0]!.participants).toEqual([
      { puuid: 'p1', riotId: 'Player#NA1', championId: 1, championName: 'Annie', teamId: 100, win: true, subteam: null, placement: null },
    ])
  })
})

describe('Arena-style games', () => {
  const original = globalThis.fetch
  let arena: boolean
  let missing: boolean

  beforeEach(() => {
    arena = true
    missing = false
    globalThis.fetch = vi.fn(async () => {
      if (missing) return new Response('', { status: 404 })
      const players = arena
        ? [1, 1, 2, 2].map((sub, i) => ({ puuid: `a${i}`, championId: i + 1, championName: `C${i}`, teamId: 100, win: sub === 2, playerSubteamId: sub, subteamPlacement: sub === 2 ? 1 : 4 }))
        : [{ puuid: 'n0', championId: 1, championName: 'Annie', teamId: 100, win: true }]
      return Response.json({ info: { queueId: arena ? 1750 : 420, gameCreation: 1, gameDuration: 900, participants: players } })
    }) as any
  })
  afterEach(() => { globalThis.fetch = original })

  async function resolvedGame(gameId: string) {
    const s = await makeSession()
    await games.reportGame(env.DB, { ...s, region: 'NA', gameId, reportedBy: 'owner' })
    for (let i = 0; i < 5; i++) await games.resolvePendingGames(env.DB, 'key')
    return { s, game: (await games.listGamesForHistory(env.DB, s.historyId))[0]! }
  }

  it('keeps each player’s subteam and placement', async () => {
    const { game } = await resolvedGame('7001')
    expect(game.status).toBe('resolved')
    expect(game.participants.map(p => [p.subteam, p.placement])).toEqual(
      expect.arrayContaining([[1, 4], [1, 4], [2, 1], [2, 1]]))
  })

  it('leaves them empty for a normal game', async () => {
    arena = false
    const { game } = await resolvedGame('7002')
    expect(game.participants[0]).toMatchObject({ subteam: null, placement: null })
  })

  it('re-fetches stored Arena games, but not plain 5v5 ones', async () => {
    const { s: arenaSession } = await resolvedGame('7003')
    arena = false
    const normal = await makeSession()
    await games.reportGame(env.DB, { ...normal, region: 'NA', gameId: '7004', reportedBy: 'owner' })
    await env.DB.prepare(`
      UPDATE party_games SET status = 'resolved', resolved_at = 1, queue_id = 420 WHERE history_id = ?1
    `).bind(normal.historyId).run()
    for (let i = 0; i < 10; i++) {
      await env.DB.prepare(`
        INSERT INTO party_game_participants (game_row_id, puuid, champion_id, team_id, win)
        SELECT id, ?2, 1, ?3, 1 FROM party_games WHERE history_id = ?1
      `).bind(normal.historyId, `p${i}`, i < 5 ? 100 : 200).run()
    }

    const migration = env.TEST_MIGRATIONS.find(m => m.name.startsWith('0016_'))!
    await env.DB.prepare(migration.queries.at(-1)!).run()

    expect((await games.listGamesForHistory(env.DB, arenaSession.historyId))[0]!.status).toBe('pending')
    expect((await games.listGamesForHistory(env.DB, normal.historyId))[0]!.status).toBe('resolved')
  })

  it('keeps a previously resolved game resolved when a re-fetch comes back empty', async () => {
    const { s } = await resolvedGame('7005')
    await env.DB.prepare("UPDATE party_games SET status = 'pending', next_attempt_at = 0, reported_at = 0 WHERE history_id = ?1")
      .bind(s.historyId).run()
    missing = true
    for (let i = 0; i < 5; i++) await games.resolvePendingGames(env.DB, 'key')
    const game = (await games.listGamesForHistory(env.DB, s.historyId))[0]!
    expect(game.status).toBe('resolved')
    expect(game.participants).toHaveLength(4)
  })
})
