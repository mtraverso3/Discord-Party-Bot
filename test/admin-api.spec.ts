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
