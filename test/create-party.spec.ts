import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPartyAndEmbed, getPartyIndex, getUserPartyId } from '../src/lib/party'

// These exercise the real create chokepoint end-to-end. The one outbound
// dependency — posting the Discord embed — goes through the global fetch, which
// we stub here. (Durable Object calls use stub.fetch, not global fetch, so they
// keep working.) This is where the duplicate-party race is actually prevented,
// so it's the key regression guard for the bug.

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
  it('creates a single party and wires up the index + owner mapping', async () => {
    const g = 'g-create-' + guildSeq++
    const r = await createPartyAndEmbed(env, opts('Solo', g))
    expect(r.ok).toBe(true)
    const index = await getPartyIndex(env.PARTY_KV, g)
    expect(index).toHaveLength(1)
    expect(await getUserPartyId(env.PARTY_KV, g, 'owner')).toBe(index[0]!.id)
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

    const index = await getPartyIndex(env.PARTY_KV, g)
    expect(index).toHaveLength(1)
    expect(await getUserPartyId(env.PARTY_KV, g, 'owner')).toBe(index[0]!.id)
  })

  it('rejects a second create once the owner already has a party', async () => {
    const g = 'g-dup-' + guildSeq++
    expect((await createPartyAndEmbed(env, opts('first', g))).ok).toBe(true)
    const second = await createPartyAndEmbed(env, opts('second', g))
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toMatch(/already in party/i)
    expect(await getPartyIndex(env.PARTY_KV, g)).toHaveLength(1)
  })

  it('lets a different owner create their own party in the same guild', async () => {
    const g = 'g-two-owners-' + guildSeq++
    expect((await createPartyAndEmbed(env, opts('A', g, 'owner-a'))).ok).toBe(true)
    expect((await createPartyAndEmbed(env, opts('B', g, 'owner-b'))).ok).toBe(true)
    expect(await getPartyIndex(env.PARTY_KV, g)).toHaveLength(2)
  })

  it('rolls back and frees the owner lock when the embed post fails', async () => {
    const g = 'g-embedfail-' + guildSeq++
    embedStatus = 403  // e.g. missing channel permissions
    const failed = await createPartyAndEmbed(env, opts('nope', g))
    expect(failed.ok).toBe(false)

    // Nothing registered, and the lock must be released so the owner isn't
    // stuck — a retry against a working channel succeeds.
    expect(await getPartyIndex(env.PARTY_KV, g)).toHaveLength(0)
    expect(await getUserPartyId(env.PARTY_KV, g, 'owner')).toBeNull()

    embedStatus = 200
    const retry = await createPartyAndEmbed(env, opts('retry', g))
    expect(retry.ok).toBe(true)
    expect(await getPartyIndex(env.PARTY_KV, g)).toHaveLength(1)
  })
})
