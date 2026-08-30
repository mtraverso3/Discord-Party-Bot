import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { repostPartyEmbed } from '../src/lib/party'
import type { PartyData } from '../src/types'
import * as parties from '../src/store/parties'

// Bumping is the one flow where two users can race over the same Discord
// message: both used to post an embed and only the last one recorded won,
// orphaning the other in the channel forever. These cover the claim that keeps
// a concurrent bump from posting at all, and the sweep that cleans up any
// duplicate that slipped through earlier.

const realFetch = globalThis.fetch

// Snowflakes are compared as numbers, so the fixtures have to look like them.
const SNOWFLAKE_BASE = 100000000000000000n
const OLDER_MSG = (SNOWFLAKE_BASE + 1n).toString()
const FIRST_EMBED = (SNOWFLAKE_BASE + 2n).toString()
const NEWER_MSG = (SNOWFLAKE_BASE + 9000n).toString()

let postSeq = 0
let postStatus = 200
let posted: string[] = []
let deleted: string[] = []
let listMessages: () => any[] = () => []
let listStatus = 200

beforeEach(() => {
  postSeq = 0
  postStatus = 200
  listStatus = 200
  posted = []
  deleted = []
  listMessages = () => []
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    if (typeof url !== 'string' || !url.includes('discord.com')) return realFetch(input, init)

    if (method === 'POST') {
      if (postStatus !== 200) return new Response('error', { status: postStatus })
      const id = (SNOWFLAKE_BASE + 1000n + BigInt(++postSeq)).toString()
      posted.push(id)
      return Response.json({ id, channel_id: 'chan' })
    }
    if (method === 'DELETE') {
      deleted.push(url.split('/').pop()!)
      return new Response(null, { status: 204 })
    }
    if (method === 'GET' && url.includes('/messages?')) {
      if (listStatus !== 200) return new Response('error', { status: listStatus })
      return Response.json(listMessages())
    }
    return Response.json({})
  }) as any
})
afterEach(() => { globalThis.fetch = realFetch })

let seq = 0

/** A party that already has an embed posted at FIRST_EMBED in "chan". */
async function makeParty(): Promise<{ guildId: string; party: PartyData }> {
  const guildId = `g-bump-${seq++}`
  const created = await parties.createParty(env.DB, {
    id: 'BUMP01',
    guildId,
    name: 'Bump me',
    description: '',
    game: 'Other',
    owner: { userId: 'owner', username: 'u', displayName: 'Owner' },
    maxSize: 3,
  })
  if (!created.ok) throw new Error(created.message)
  const party = await parties.setEmbedMessage(env.DB, guildId, 'BUMP01', FIRST_EMBED, 'chan')
  return { guildId, party: party! }
}

/** A channel message shaped like one of our party embeds. */
function embedMessage(id: string, party: PartyData, opts: { authorId?: string; createdAt?: number } = {}) {
  const at = opts.createdAt ?? party.createdAt
  return {
    id,
    author: { id: opts.authorId ?? env.DISCORD_APPLICATION_ID },
    // Discord echoes timestamps back with microseconds and an explicit offset.
    embeds: [{
      footer: { text: `Other · 🟢 OPEN · ID: ${party.id}` },
      timestamp: new Date(at).toISOString().replace('Z', '000+00:00'),
    }],
  }
}

describe('repostPartyEmbed', () => {
  it('posts exactly one embed when two bumps race', async () => {
    const { guildId, party } = await makeParty()

    const results = await Promise.all([
      repostPartyEmbed(env, party, 'chan'),
      repostPartyEmbed(env, party, 'chan'),
    ])

    expect(results.filter(r => r === 'reposted')).toHaveLength(1)
    expect(results.filter(r => r === 'superseded')).toHaveLength(1)
    expect(posted).toHaveLength(1)

    // The party points at the one message that was posted, and the old embed
    // is gone rather than left behind.
    const after = await parties.getParty(env.DB, guildId, 'BUMP01')
    expect(after!.embedMessageId).toBe(posted[0])
    expect(deleted).toContain(FIRST_EMBED)
  })

  it('replaces the old embed on a normal bump', async () => {
    const { guildId, party } = await makeParty()
    expect(await repostPartyEmbed(env, party, 'chan')).toBe('reposted')
    expect(posted).toHaveLength(1)
    expect(deleted).toEqual([FIRST_EMBED])
    const after = await parties.getParty(env.DB, guildId, 'BUMP01')
    expect(after!.embedChannelId).toBe('chan')
  })

  it('bumps again from the pointer the previous bump left', async () => {
    const { guildId, party } = await makeParty()
    await repostPartyEmbed(env, party, 'chan')
    const mid = (await parties.getParty(env.DB, guildId, 'BUMP01'))!
    expect(await repostPartyEmbed(env, mid, 'chan')).toBe('reposted')
    expect(deleted).toContain(posted[0])
  })

  it('sweeps older duplicates of the same party and spares everything else', async () => {
    const { party } = await makeParty()
    listMessages = () => [
      embedMessage(OLDER_MSG, party),                                        // leftover duplicate
      embedMessage(NEWER_MSG, party),                                        // newer than ours
      embedMessage(OLDER_MSG + '1', party, { authorId: 'someone-else' }),    // not ours
      embedMessage(OLDER_MSG + '2', party, { createdAt: party.createdAt - 60_000 }), // recycled ID
      { id: OLDER_MSG + '3', author: { id: env.DISCORD_APPLICATION_ID }, embeds: [] },
    ]

    await repostPartyEmbed(env, party, 'chan')

    expect(deleted).toContain(OLDER_MSG)
    expect(deleted).not.toContain(NEWER_MSG)
    expect(deleted).not.toContain(OLDER_MSG + '1')
    expect(deleted).not.toContain(OLDER_MSG + '2')
    expect(deleted).not.toContain(OLDER_MSG + '3')
  })

  it('never deletes the embed it just posted', async () => {
    const { party } = await makeParty()
    // The listing includes the message we just posted, as a real channel's would.
    listMessages = () => posted.map(id => embedMessage(id, party))

    await repostPartyEmbed(env, party, 'chan')

    expect(posted).toHaveLength(1)
    expect(deleted).not.toContain(posted[0])
  })

  it('still bumps when the channel listing is unavailable', async () => {
    const { party } = await makeParty()
    listStatus = 403  // e.g. no Read Message History
    expect(await repostPartyEmbed(env, party, 'chan')).toBe('reposted')
    expect(posted).toHaveLength(1)
  })

  it('keeps the old embed when the new one cannot be posted', async () => {
    const { guildId, party } = await makeParty()
    postStatus = 403
    await expect(repostPartyEmbed(env, party, 'chan')).rejects.toThrow()

    // The claim is handed back, so the party still has its embed and the next
    // bump works instead of the party going embed-less.
    const after = await parties.getParty(env.DB, guildId, 'BUMP01')
    expect(after!.embedMessageId).toBe(FIRST_EMBED)
    expect(deleted).toEqual([])

    postStatus = 200
    expect(await repostPartyEmbed(env, after!, 'chan')).toBe('reposted')
  })
})
