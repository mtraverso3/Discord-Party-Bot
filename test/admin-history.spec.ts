import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { handleAdminApi } from '../src/admin/api'
import * as parties from '../src/store/parties'
import * as history from '../src/store/history'
import * as games from '../src/store/games'

let seq = 0
const user = (id: string) => ({ userId: id, username: `${id}_un`, displayName: id.toUpperCase() })

async function get(path: string, guildId: string) {
  const url = new URL('http://x/admin/api' + path + (path.includes('?') ? '&' : '?') + 'guild=' + guildId)
  const res = await handleAdminApi(new Request(url), env, url)
  return { status: res.status, body: await res.json<any>() }
}

async function seed() {
  const guildId = `ah-${Date.now()}-${seq++}`
  const created = await parties.createParty(env.DB, {
    id: 'ADM01', guildId, name: 'Admin party', description: '', game: 'LoL NA',
    owner: user('owner'), maxSize: 3,
  })
  if (!created.ok) throw new Error(created.message)
  await parties.joinParty(env.DB, guildId, 'ADM01', user('a'))
  return { guildId, partyId: 'ADM01' }
}

describe('admin history API', () => {
  it('lists sessions with counts', async () => {
    const { guildId } = await seed()
    const { status, body } = await get('/history', guildId)
    expect(status).toBe(200)
    expect(body).toHaveLength(1)
    expect(body[0].partyId).toBe('ADM01')
    expect(body[0].eventCount).toBeGreaterThanOrEqual(2)  // created + joined
    expect(body[0].participantCount).toBe(2)              // owner + a
  })

  it('returns a session detail with events and games', async () => {
    const { guildId, partyId } = await seed()
    const historyId = (await history.activeSessionId(env.DB, guildId, partyId))!
    await games.reportGame(env.DB, { historyId, guildId, partyId, region: 'NA', gameId: '77', reportedBy: 'owner' })

    const { status, body } = await get('/history/' + historyId, guildId)
    expect(status).toBe(200)
    expect(body.session.partyId).toBe('ADM01')
    expect(body.events.map((e: any) => e.event)).toContain('joined')
    expect(body.games).toHaveLength(1)
    expect(body.games[0].matchId).toBe('NA1_77')
  })

  it('404s an unknown session', async () => {
    const { guildId } = await seed()
    expect((await get('/history/999999', guildId)).status).toBe(404)
  })

  it('exposes a live party’s games via /parties/:id/games', async () => {
    const { guildId, partyId } = await seed()
    const historyId = (await history.activeSessionId(env.DB, guildId, partyId))!
    await games.reportGame(env.DB, { historyId, guildId, partyId, region: 'NA', gameId: '88', reportedBy: 'owner' })
    const { status, body } = await get('/parties/' + partyId + '/games', guildId)
    expect(status).toBe(200)
    expect(body.historyId).toBe(historyId)
    expect(body.games).toHaveLength(1)
  })
})
