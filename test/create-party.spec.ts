import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPartyAndEmbed } from '../src/lib/party'
import { countParties, getUserPartyId } from '../src/store/parties'

// These exercise the real create chokepoint end-to-end. The one outbound
// dependency — posting the Discord embed — goes through the global fetch,
// which we stub here. The duplicate-party race is prevented by the D1
// party_members primary key, so this is the key regression guard for it.

const realFetch = globalThis.fetch
let embedStatus = 200

beforeEach(() => {
  embedStatus = 200
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url
    if (typeof url === 'string' && url.includes('discord.com')) {
      if (embedStatus !== 200) return new Response('error', { status: embedStatus })
      return Response.json({ id: 'msg-' + Math.random().toString(36).slice(2), channel_id: 'chan' })
    }
    return realFetch(input, init)
  }) as any
})
afterEach(() => { globalThis.fetch = realFetch })

let guildSeq = 0
function opts(name: string, guildId: string, ownerId = 'owner') {
  return {
    guildId,
    channelId: 'chan',
    owner: { id: ownerId, username: 'u', displayName: 'Owner' },
    name,
    description: '',
    game: 'Other',
    maxSize: 3,
  }
}

describe('createPartyAndEmbed', () => {
  it('creates a single party and records the owner membership', async () => {
    const g = 'g-create-' + guildSeq++
    const r = await createPartyAndEmbed(env, opts('Solo', g))
    expect(r.ok).toBe(true)
    expect(await countParties(env.DB, g)).toBe(1)
    expect(await getUserPartyId(env.DB, g, 'owner')).toBe(r.ok ? r.party.id : null)
  })

  it('serializes two concurrent creates for the same owner — exactly one wins', async () => {
    const g = 'g-race-' + guildSeq++
    const [a, b] = await Promise.all([
      createPartyAndEmbed(env, opts('A', g)),
      createPartyAndEmbed(env, opts('B', g)),
    ])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)

    // The losing request must be rejected, never a silent second party.
    const loser = a.ok ? b : a
    expect(loser.ok).toBe(false)

    expect(await countParties(env.DB, g)).toBe(1)
    expect(await getUserPartyId(env.DB, g, 'owner')).not.toBeNull()
  })

  it('rejects a second create once the owner already has a party', async () => {
    const g = 'g-dup-' + guildSeq++
    expect((await createPartyAndEmbed(env, opts('first', g))).ok).toBe(true)
    const second = await createPartyAndEmbed(env, opts('second', g))
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toMatch(/already in a party/i)
    expect(await countParties(env.DB, g)).toBe(1)
  })

  it('lets a different owner create their own party in the same guild', async () => {
    const g = 'g-two-owners-' + guildSeq++
    expect((await createPartyAndEmbed(env, opts('A', g, 'owner-a'))).ok).toBe(true)
    expect((await createPartyAndEmbed(env, opts('B', g, 'owner-b'))).ok).toBe(true)
    expect(await countParties(env.DB, g)).toBe(2)
  })

  it('rolls back when the embed post fails, so a retry succeeds', async () => {
    const g = 'g-embedfail-' + guildSeq++
    embedStatus = 403  // e.g. missing channel permissions
    const failed = await createPartyAndEmbed(env, opts('nope', g))
    expect(failed.ok).toBe(false)

    // Nothing left behind — a retry against a working channel succeeds.
    expect(await countParties(env.DB, g)).toBe(0)
    expect(await getUserPartyId(env.DB, g, 'owner')).toBeNull()

    embedStatus = 200
    const retry = await createPartyAndEmbed(env, opts('retry', g))
    expect(retry.ok).toBe(true)
    expect(await countParties(env.DB, g)).toBe(1)
  })
})
