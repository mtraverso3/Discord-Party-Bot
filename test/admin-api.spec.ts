import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleAdminApi } from '../src/admin/api'

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
