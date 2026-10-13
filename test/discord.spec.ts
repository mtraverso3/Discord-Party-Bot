import { afterEach, describe, expect, it, vi } from 'vitest'
import { getGuildMember, getMemberAvatarUrl } from '../src/lib/discord'

// The desktop client resolves every party member's avatar in parallel. When
// Discord rate-limits that burst, unread 429 bodies used to pin the Worker's
// six connections until the runtime cancelled them, and the failed lookups were
// cached as "no avatar" for six hours.

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

function stubDiscord(handler: (url: string) => Response) {
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url
    if (typeof url !== 'string' || !url.includes('discord.com')) return realFetch(input, init)
    return handler(url)
  }) as any
}

function rateLimited(onCancel: () => void): Response {
  const body = new ReadableStream({ cancel: onCancel })
  return new Response(body, { status: 429, headers: { 'retry-after': '0.01' } })
}

let seq = 0

describe('Discord rate limits', () => {
  it('releases a 429 body before retrying', async () => {
    let cancelled = 0
    let calls = 0
    stubDiscord(() => (++calls === 1
      ? rateLimited(() => { cancelled++ })
      : Response.json({ user: { id: 'u', username: 'u' } })))

    await getGuildMember('token', 'g', 'u')
    expect(calls).toBe(2)
    expect(cancelled).toBe(1)
  })
})

describe('getMemberAvatarUrl', () => {
  it('does not cache a failed lookup, so the next call retries', async () => {
    const guildId = `g-avatar-${seq++}`
    let fail = true
    stubDiscord(() => (fail
      ? new Response('rate limited', { status: 429 })
      : Response.json({ user: { id: 'u', avatar: 'abc' } })))

    expect(await getMemberAvatarUrl('token', guildId, 'u')).toBeNull()

    fail = false
    expect(await getMemberAvatarUrl('token', guildId, 'u'))
      .toBe('https://cdn.discordapp.com/avatars/u/abc.png?size=64')
  })

  it('still caches a member with no custom avatar', async () => {
    const guildId = `g-avatar-${seq++}`
    let calls = 0
    stubDiscord(() => { calls++; return Response.json({ user: { id: 'u', avatar: null } }) })

    expect(await getMemberAvatarUrl('token', guildId, 'u')).toBeNull()
    expect(await getMemberAvatarUrl('token', guildId, 'u')).toBeNull()
    expect(calls).toBe(1)
  })
})
