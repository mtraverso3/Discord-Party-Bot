import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchLiveGame } from '../src/lib/riot'

let seq = 0
const uniqueName = () => `Live${Date.now()}x${seq++}`

describe('fetchLiveGame caching', () => {
  const original = globalThis.fetch
  let accountCalls: string[]
  let spectatorCalls: string[]
  let accountStatus: number
  let spectatorStatus: number

  beforeEach(() => {
    accountCalls = []
    spectatorCalls = []
    accountStatus = 200
    spectatorStatus = 200
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = String(input)
      if (url.includes('/riot/account/v1/')) {
        const gameName = decodeURIComponent(url.split('/').slice(-2)[0]!)
        accountCalls.push(gameName)
        if (accountStatus !== 200) return new Response('boom', { status: accountStatus })
        return Response.json({ puuid: `puuid-${gameName}` })
      }
      if (url.includes('/lol/spectator/v5/')) {
        spectatorCalls.push(decodeURIComponent(url.split('/').pop()!))
        if (spectatorStatus !== 200) return new Response('', { status: spectatorStatus })
        return Response.json({
          gameId: 42,
          participants: [{ riotId: 'Me#NA1', championId: 1, teamId: 100 }],
        })
      }
      return new Response('unexpected', { status: 500 })
    }) as any
  })
  afterEach(() => { globalThis.fetch = original })

  it('calls Account-v1 and Spectator once across repeated lookups', async () => {
    const name = uniqueName()
    const first = await fetchLiveGame('key', 'NA', name, 'NA1')
    const second = await fetchLiveGame('key', 'NA', name, 'NA1')
    expect(first).toEqual({ gameId: 42, participants: [{ riotId: 'Me#NA1', championId: 1, teamId: 100 }] })
    expect(second).toEqual(first)
    expect(accountCalls).toEqual([name])
    expect(spectatorCalls).toEqual([`puuid-${name}`])
  })

  it('caches "not in a game" briefly', async () => {
    const name = uniqueName()
    spectatorStatus = 404
    expect(await fetchLiveGame('key', 'NA', name, 'NA1')).toBeNull()
    expect(await fetchLiveGame('key', 'NA', name, 'NA1')).toBeNull()
    expect(spectatorCalls).toHaveLength(1)
  })

  it('does not cache Account-v1 errors', async () => {
    const name = uniqueName()
    accountStatus = 429
    await expect(fetchLiveGame('key', 'NA', name, 'NA1')).rejects.toThrow(/account 429/)
    accountStatus = 200
    expect(await fetchLiveGame('key', 'NA', name, 'NA1')).not.toBeNull()
    expect(accountCalls).toEqual([name, name])
  })

  it('does not cache Spectator errors, but keeps the resolved puuid', async () => {
    const name = uniqueName()
    spectatorStatus = 500
    await expect(fetchLiveGame('key', 'NA', name, 'NA1')).rejects.toThrow(/spectator 500/)
    spectatorStatus = 200
    expect(await fetchLiveGame('key', 'NA', name, 'NA1')).not.toBeNull()
    expect(spectatorCalls).toHaveLength(2)
    expect(accountCalls).toEqual([name])
  })
})
