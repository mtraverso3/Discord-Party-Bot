import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleAdminApi } from '../src/admin/api'
import { getUserIgn } from '../src/store/profiles'
import { createParty, getParty } from '../src/store/parties'

// The settings allowlists resolve user IDs to names through GET
// /members/resolve. Stub the two Discord endpoints it leans on (guild member
// lookup + global user lookup) via the global fetch.

const realFetch = globalThis.fetch

beforeEach(() => {
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url
    const path = new URL(url).pathname
    // Guild member lookup: only "inguild" is a current member.
    if (path.endsWith('/members/inguild')) {
      return Response.json({ user: { id: 'inguild', username: 'inguild_un', global_name: 'InGuildGlobal' }, nick: 'GuildNick' })
    }
    if (path.includes('/guilds/') && path.includes('/members/')) {
      return new Response('Unknown Member', { status: 404 })
    }
    // Global user lookup: "leftguild" still exists as a user, "ghost" doesn't.
    if (path.endsWith('/users/leftguild')) {
      return Response.json({ id: 'leftguild', username: 'leftguild_un', global_name: 'LeftGuildGlobal' })
    }
    if (path.endsWith('/users/777')) {
      return Response.json({ id: '777', username: 'seven_un', global_name: 'SevenGlobal' })
    }
    if (path.includes('/users/')) {
      return new Response('Unknown User', { status: 404 })
    }
    return realFetch(input, init)
  }) as any
})
afterEach(() => { globalThis.fetch = realFetch })

async function resolve(ids: string): Promise<Record<string, string>> {
  const url = new URL('http://x/admin/api/members/resolve?guild=g1&ids=' + encodeURIComponent(ids))
  const res = await handleAdminApi(new Request(url), env, url)
  return res.json()
}

describe('per-guild magic-link scoping', () => {
  const domain = 'discord.local'
  const scopedEmail = (uid: string, gid: string) => `${uid}@${gid}.${domain}`

  it('lets a super admin (real email) reach any guild', async () => {
    const url = new URL('http://x/admin/api/settings?guild=g1')
    const res = await handleAdminApi(new Request(url), env, url, 'boss@example.com')
    expect(res.status).toBe(200)
  })

  it('blocks a magic-link admin from a guild that is not theirs', async () => {
    const url = new URL('http://x/admin/api/settings?guild=other')
    const res = await handleAdminApi(new Request(url), env, url, scopedEmail('123', 'g1'))
    expect(res.status).toBe(403)
  })

  it('allows a magic-link admin into their own guild', async () => {
    const url = new URL('http://x/admin/api/settings?guild=g1')
    const res = await handleAdminApi(new Request(url), env, url, scopedEmail('123', 'g1'))
    expect(res.status).toBe(200)
  })

  it('forbids a magic-link admin from adding admins', async () => {
    const url = new URL('http://x/admin/api/admins?guild=g1')
    const res = await handleAdminApi(
      new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"userId":"111111111111111111"}' }),
      env, url, scopedEmail('123', 'g1'),
    )
    expect(res.status).toBe(403)
  })

  it('returns the real email for a super admin on /me', async () => {
    const url = new URL('http://x/admin/api/me')
    const res = await handleAdminApi(new Request(url), env, url, 'boss@example.com')
    const me = await res.json<any>()
    expect(me).toEqual({ email: 'boss@example.com', superAdmin: true })
  })

  it('resolves a magic-link admin to their Discord name and never surfaces the synthetic email', async () => {
    // User 777 isn't on the allow-list, so /me falls back to the live global name.
    const url = new URL('http://x/admin/api/me')
    const res = await handleAdminApi(new Request(url), env, url, scopedEmail('777', 'g1'))
    const me = await res.json<any>()
    expect(me.superAdmin).toBe(false)
    expect(me.guildId).toBe('g1')
    expect(me.displayName).toBe('SevenGlobal')
    expect(me.email).toBeUndefined()
  })

  it('lets a super admin add and remove per-guild admins', async () => {
    const addUrl = new URL('http://x/admin/api/admins?guild=g1')
    const added = await handleAdminApi(
      new Request(addUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"userId":"111111111111111111","displayName":"A"}' }),
      env, addUrl, 'boss@example.com',
    )
    expect(added.status).toBe(200)
    const list = await added.json<any[]>()
    expect(list.find(a => a.userId === '111111111111111111')).toBeTruthy()

    const delUrl = new URL('http://x/admin/api/admins/111111111111111111?guild=g1')
    const removed = await handleAdminApi(new Request(delUrl, { method: 'DELETE' }), env, delUrl, 'boss@example.com')
    expect(removed.status).toBe(200)
  })
})

describe('GET /members/resolve', () => {
  it('prefers the guild nickname, falls back to the global username, and skips unknowns', async () => {
    const names = await resolve('inguild,leftguild,ghost')
    expect(names.inguild).toBe('GuildNick')          // nick wins over global/username
    expect(names.leftguild).toBe('LeftGuildGlobal')  // not in guild → global user lookup
    expect(names.ghost).toBeUndefined()              // unresolvable → left for the UI to show the raw ID
  })

  it('dedupes ids and tolerates blanks', async () => {
    const names = await resolve('inguild, inguild ,,leftguild')
    expect(Object.keys(names).sort()).toEqual(['inguild', 'leftguild'])
  })
})

describe("channels must belong to the admin's guild", () => {
  const TEXT = '700000000000000001'
  const VOICE = '700000000000000002'
  const FOREIGN = '799999999999999999'
  let posts: string[]
  let seq = 0

  beforeEach(() => {
    posts = []
    const inner = globalThis.fetch
    globalThis.fetch = vi.fn(async (input: any, init?: any) => {
      const path = new URL(typeof input === 'string' ? input : input.url).pathname
      if (path.endsWith('/channels')) return Response.json([{ id: TEXT, type: 0 }, { id: VOICE, type: 2 }])
      if (path.endsWith('/messages')) { posts.push(path); return Response.json({ id: `m${posts.length}`, channel_id: TEXT }) }
      return inner(input, init)
    }) as any
  })

  async function api(guild: string, method: string, path: string, body?: unknown) {
    const url = new URL(`http://x/admin/api${path}?guild=${guild}`)
    return handleAdminApi(new Request(url, {
      method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    }), env, url, `1@${guild}.discord.local`)
  }
  const create = (guild: string, extra: Record<string, string>) =>
    api(guild, 'POST', '/parties', { ownerId: 'inguild', channelId: TEXT, ...extra })

  it('creates a party in its own channels', async () => {
    const res = await create(`cg${++seq}`, { voiceChannelId: VOICE })
    expect(res.status).toBe(200)
    expect(posts).toEqual([`/api/v10/channels/${TEXT}/messages`])
  })

  it("refuses another server's text or voice channel", async () => {
    expect((await create(`cg${++seq}`, { channelId: FOREIGN })).status).toBe(400)
    expect((await create(`cg${++seq}`, { voiceChannelId: FOREIGN })).status).toBe(400)
    expect((await create(`cg${++seq}`, { voiceChannelId: TEXT })).status).toBe(400)
    expect(posts).toEqual([])
  })

  it('refuses to bump or re-point an existing party elsewhere', async () => {
    const g = `cg${++seq}`
    const party = await (await create(g, {})).json<any>()
    posts = []
    expect((await api(g, 'POST', `/parties/${party.id}/bump`, { channelId: FOREIGN })).status).toBe(400)
    expect((await api(g, 'PATCH', `/parties/${party.id}`, { voiceChannelId: FOREIGN })).status).toBe(400)
    expect(posts).toEqual([])
    expect((await api(g, 'PATCH', `/parties/${party.id}`, { voiceChannelId: VOICE })).status).toBe(200)
  })
})

describe('PATCH /users/:id/profile', () => {
  async function patch(userId: string, ign: string) {
    const url = new URL(`http://x/admin/api/users/${userId}/profile?guild=g1`)
    return handleAdminApi(new Request(url, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: 'Valorant', ign }),
    }), env, url, '1@g1.discord.local')
  }

  it("edits a member's IGN", async () => {
    const res = await patch('inguild', 'Shooty#NA1')
    expect(res.status).toBe(200)
    expect((await res.json<any>()).igns.Valorant).toBe('Shooty#NA1')
  })

  it("won't touch someone outside the guild", async () => {
    expect((await patch('leftguild', 'Hijacked')).status).toBe(404)
    expect(await getUserIgn(env.DB, 'leftguild', 'Valorant')).toBeUndefined()
  })
})

describe('cross-site requests', () => {
  async function send(method: string, path: string, headers: Record<string, string>) {
    const url = new URL(`https://party.example.test/admin/api${path}?guild=csrf`)
    return handleAdminApi(new Request(url, { method, headers }), env, url, 'boss@example.com')
  }

  const seed = () => createParty(env.DB, {
    id: 'CSRF01', guildId: 'csrf', name: 'p', description: '', game: 'Other',
    owner: { userId: 'o', username: 'o', displayName: 'O' }, maxSize: 5,
  })

  it('refuses writes from another origin or site', async () => {
    await seed()
    expect((await send('POST', '/clear', { origin: 'https://evil.test' })).status).toBe(403)
    expect((await send('DELETE', '/parties/CSRF01', { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await send('POST', '/clear', { 'sec-fetch-site': 'same-site' })).status).toBe(403)
    expect(await getParty(env.DB, 'csrf', 'CSRF01')).not.toBeNull()
  })

  it('allows reads from anywhere and writes from the dashboard itself', async () => {
    await seed()
    expect((await send('GET', '/settings', { 'sec-fetch-site': 'cross-site' })).status).toBe(200)
    const res = await send('POST', '/clear', { origin: 'https://party.example.test', 'sec-fetch-site': 'same-origin' })
    expect(res.status).toBe(200)
    expect(await getParty(env.DB, 'csrf', 'CSRF01')).toBeNull()
  })
})

describe('admin API hardening', () => {
  it("doesn't leak internal error details", async () => {
    const url = new URL('http://x/admin/api/settings?guild=g1')
    const broken = { ...env, DB: { prepare() { throw new Error('D1_ERROR: secret table detail') } } } as any
    const res = await handleAdminApi(new Request(url), broken, url, 'boss@example.com')
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('secret')
  })

  it('caps admin display names', async () => {
    const url = new URL('http://x/admin/api/admins?guild=g-cap')
    const res = await handleAdminApi(new Request(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: '123456789012345678', displayName: 'n'.repeat(5000) }),
    }), env, url, 'boss@example.com')
    const [admin] = await res.json<any[]>()
    expect(admin.displayName).toHaveLength(100)
  })
})
