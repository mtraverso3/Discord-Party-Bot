import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tryMarkDisbanded } from '../src/lib/party'
import * as parties from '../src/store/parties'
import type { PartyData } from '../src/types'

// Disbanding greys the party's message out. The database points at one
// message, but a bump that raced before the embed claim existed could leave
// untracked copies behind — and the pointer names whichever was recorded last,
// not necessarily the one at the bottom of the channel. Those copies used to
// survive the disband still advertising the party with live buttons.

const realFetch = globalThis.fetch

const TRACKED = '100000000000000002'
const ORPHAN = '100000000000000009'  // posted after TRACKED, never recorded

let patched: string[] = []
let listMessages: () => any[] = () => []
let listStatus = 200
let patchStatus = 200
let retryAfterSeconds = 0.01
let rateLimited = 0

beforeEach(() => {
  patched = []
  listMessages = () => []
  listStatus = 200
  patchStatus = 200
  retryAfterSeconds = 0.01
  rateLimited = 0
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url
    if (typeof url !== 'string' || !url.includes('discord.com')) return realFetch(input, init)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'PATCH') {
      if (patchStatus === 429) {
        rateLimited++
        // A retry that respects Retry-After gets through; too long a wait doesn't.
        if (retryAfterSeconds <= 1) patchStatus = 200
        return new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': String(retryAfterSeconds) },
        })
      }
      if (patchStatus !== 200) return new Response('nope', { status: patchStatus })
      patched.push(url.split('/').pop()!)
      return Response.json({})
    }
    if (method === 'GET' && url.includes('/messages?')) {
      if (listStatus !== 200) return new Response('nope', { status: listStatus })
      return Response.json(listMessages())
    }
    return Response.json({})
  }) as any
})
afterEach(() => { globalThis.fetch = realFetch })

let seq = 0

/** A disbanded party, as the disband paths hand it to the embed helpers. */
async function disbandedParty(opts: { trackedId?: string | null } = {}): Promise<PartyData> {
  const guildId = `g-disband-${seq++}`
  const created = await parties.createParty(env.DB, {
    id: 'DIS001', guildId, name: 'Doomed', description: '', game: 'Other',
    owner: { userId: 'owner', username: 'u', displayName: 'Owner' }, maxSize: 3,
  })
  if (!created.ok) throw new Error(created.message)
  const trackedId = opts.trackedId === undefined ? TRACKED : opts.trackedId
  if (trackedId) await parties.setEmbedMessage(env.DB, guildId, 'DIS001', trackedId, 'chan')
  const result = await parties.disbandParty(env.DB, guildId, 'DIS001', 'owner')
  const party = result.data!
  // A pointer that was lost mid-bump leaves the channel known but no message.
  return trackedId ? party : { ...party, embedChannelId: 'chan', embedMessageId: undefined }
}

function embedMessage(id: string, party: PartyData, opts: { authorId?: string; createdAt?: number; partyId?: string } = {}) {
  return {
    id,
    author: { id: opts.authorId ?? env.DISCORD_APPLICATION_ID },
    embeds: [{
      footer: { text: `Other · 🟢 OPEN · ID: ${opts.partyId ?? party.id}` },
      timestamp: new Date(opts.createdAt ?? party.createdAt).toISOString().replace('Z', '000+00:00'),
    }],
  }
}

describe('markDisbanded', () => {
  it('greys out the message the party points at', async () => {
    const party = await disbandedParty()
    expect(await tryMarkDisbanded(env, party)).toBe(1)
    expect(patched).toEqual([TRACKED])
  })

  it('also greys out an untracked copy left in the channel', async () => {
    const party = await disbandedParty()
    listMessages = () => [embedMessage(ORPHAN, party), embedMessage(TRACKED, party)]

    await tryMarkDisbanded(env, party)

    expect(patched).toContain(ORPHAN)
    expect(patched).toContain(TRACKED)
    expect(patched).toHaveLength(2)  // the tracked one is not edited twice
  })

  it('greys the message out even when the pointer was lost', async () => {
    const party = await disbandedParty({ trackedId: null })
    listMessages = () => [embedMessage(ORPHAN, party)]

    await tryMarkDisbanded(env, party)

    expect(patched).toEqual([ORPHAN])
  })

  it('leaves other bots, other parties and recycled IDs alone', async () => {
    const party = await disbandedParty()
    listMessages = () => [
      embedMessage('100000000000000011', party, { authorId: 'another-bot' }),
      embedMessage('100000000000000012', party, { partyId: 'OTHER1' }),
      embedMessage('100000000000000013', party, { createdAt: party.createdAt - 60_000 }),
      { id: '100000000000000014', author: { id: env.DISCORD_APPLICATION_ID }, embeds: [] },
    ]

    await tryMarkDisbanded(env, party)

    expect(patched).toEqual([TRACKED])
  })

  it('still greys out the tracked message when the channel cannot be read', async () => {
    const party = await disbandedParty()
    listStatus = 403  // no Read Message History
    await tryMarkDisbanded(env, party)
    expect(patched).toEqual([TRACKED])
  })

  it('reports nothing updated when the message is already gone', async () => {
    const party = await disbandedParty()
    patchStatus = 404
    expect(await tryMarkDisbanded(env, party)).toBe(0)
  })

  it('retries a rate-limited edit instead of dropping it', async () => {
    const party = await disbandedParty()
    patchStatus = 429  // cleared by the stub after the first 429

    expect(await tryMarkDisbanded(env, party)).toBe(1)
    expect(patched).toEqual([TRACKED])
    expect(rateLimited).toBe(1)
  })

  it('gives up on a rate limit it would have to wait too long for', async () => {
    const party = await disbandedParty()
    patchStatus = 429
    retryAfterSeconds = 30  // longer than we'll hold a Worker open

    expect(await tryMarkDisbanded(env, party)).toBe(0)
    expect(rateLimited).toBe(1)  // no retry attempted
  })

  it('does nothing for a party that never had a channel', async () => {
    const party = await disbandedParty()
    expect(await tryMarkDisbanded(env, { ...party, embedChannelId: undefined })).toBe(0)
    expect(patched).toEqual([])
  })
})
