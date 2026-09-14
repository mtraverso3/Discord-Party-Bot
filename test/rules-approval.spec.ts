import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as parties from '../src/store/parties'
import { rulesAccess } from '../src/lib/rules'
import { sweepRulesApproval } from '../src/lib/rules-sweep'
import { handleClientApi } from '../src/client-api'
import { createClientToken } from '../src/store/clientAuth'
import { handleAdminApi } from '../src/admin/api'
import { handleJoinButton, handleQueueButton } from '../src/components/buttons'

const G = '100000000000000000'
const ROLE = '200000000000000000'
const OWNER = '300000000000000000'
const BAD = '400000000000000000'
const GOOD = '500000000000000000'
const ACTIVE = '600000000000000000'
const gatedEnv = () => ({ ...env, RULES_APPROVAL_ROLES: JSON.stringify({ [G]: ROLE }) })
const user = (id: string) => ({ userId: id, username: id, displayName: id })
let seq = 0
let approved: Set<string>
let failure = 0
const originalFetch = globalThis.fetch

beforeEach(() => {
  approved = new Set([OWNER, GOOD, ACTIVE])
  failure = 0
  globalThis.fetch = vi.fn(async (input: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    if (url.pathname.includes('/members/')) {
      if (failure) return new Response('Unavailable', { status: failure })
      const id = url.pathname.split('/').pop()!
      return Response.json({ user: { id, username: id }, roles: approved.has(id) ? [ROLE] : [] })
    }
    return Response.json({ id: 'message', channel_id: 'channel' })
  }) as any
})
afterEach(() => { globalThis.fetch = originalFetch })

async function make(maxSize = 2) {
  const id = `R${seq++}`
  // Each test uses a new guild so fixture data cannot conflict.
  const guildId = String(BigInt(G) + BigInt(seq))
  const bindings = { ...env, RULES_APPROVAL_ROLES: JSON.stringify({ [guildId]: ROLE }) }
  const policy = rulesAccess(bindings)
  await parties.createParty(env.DB, { id, guildId, name: 'Arena', description: '', game: 'Other', owner: user(OWNER), maxSize }, policy)
  return { id, guildId, bindings, policy }
}

describe('rules approval policy', () => {
  it('allows approved users and denies unapproved users without caching', async () => {
    const policy = rulesAccess(gatedEnv())
    await policy.require(G, GOOD)
    approved.delete(GOOD)
    await expect(policy.require(G, GOOD)).rejects.toThrow('Complete the rules check')
  })

  it('preserves unconfigured servers and rejects malformed configuration', async () => {
    await rulesAccess(env).require(G, BAD)
    await rulesAccess(gatedEnv()).require('900000000000000000', BAD)
    await expect(rulesAccess({ ...env, RULES_APPROVAL_ROLES: 'broken' }).require(G, GOOD)).rejects.toThrow('misconfigured')
  })

  it.each([403, 429, 500])('fails closed on Discord %i', async status => {
    failure = status
    await expect(rulesAccess(gatedEnv()).require(G, GOOD)).rejects.toThrow('could not verify')
  })

  it('denies members who left the server', async () => {
    failure = 404
    await expect(rulesAccess(gatedEnv()).require(G, GOOD)).rejects.toThrow('Complete the rules check')
  })
})

describe('queue operations', () => {
  it('gates party creators, direct joins, and owner force-adds', async () => {
    const { id, guildId, policy } = await make(4)
    await expect(parties.createParty(env.DB, { id: 'BAD', guildId, name: 'x', description: '', game: 'Other', owner: user(BAD), maxSize: 4 }, policy)).rejects.toThrow('rules check')
    await expect(parties.joinParty(env.DB, guildId, id, user(BAD), policy)).rejects.toThrow('rules check')
    await expect(parties.forceAdd(env.DB, guildId, id, OWNER, user(BAD), policy)).rejects.toThrow('rules check')
    expect((await parties.getParty(env.DB, guildId, id))!.members).toHaveLength(1)
    expect((await parties.joinParty(env.DB, guildId, id, user(GOOD), policy)).status).toBe('joined')
  })

  it('gates manual queue approval and ownership transfer', async () => {
    const { id, guildId, policy } = await make(4)
    await parties.joinParty(env.DB, guildId, id, user(BAD)) // pre-integration member
    await expect(parties.promoteOwner(env.DB, guildId, id, OWNER, BAD, policy)).rejects.toThrow('rules check')
    await parties.closeParty(env.DB, guildId, id, OWNER)
    await parties.joinParty(env.DB, guildId, id, user(GOOD), policy)
    approved.delete(GOOD)
    await expect(parties.approveQueued(env.DB, guildId, id, OWNER, GOOD, policy)).rejects.toThrow('rules check')
  })

  it('skips revoked queue entries on leave and preserves FIFO champion bans', async () => {
    const { id, guildId, policy } = await make()
    await parties.joinParty(env.DB, guildId, id, user(ACTIVE), policy)
    await parties.joinParty(env.DB, guildId, id, user(BAD))
    await parties.joinParty(env.DB, guildId, id, user(GOOD), policy)
    await parties.setBanlist(env.DB, guildId, id, OWNER, 'Garen\nLux\nAhri')
    const result = await parties.leaveParty(env.DB, guildId, id, ACTIVE, 'left', policy)
    expect(result.promoted).toBe(GOOD)
    expect(result.data!.members.map(m => m.userId)).toEqual([OWNER, GOOD])
    expect(result.data!.banlist!.assignments[GOOD]).toBe('Ahri')
    expect(result.data!.banlist!.assignments[BAD]).toBeUndefined()
  })

  it('gates promotions on reopen and capacity expansion', async () => {
    const { id, guildId, policy } = await make()
    await parties.closeParty(env.DB, guildId, id, OWNER)
    await parties.joinParty(env.DB, guildId, id, user(BAD))
    await parties.joinParty(env.DB, guildId, id, user(GOOD), policy)
    const result = await parties.openParty(env.DB, guildId, id, OWNER, policy)
    expect(result.promoted).toEqual([GOOD])
    const expanded = await parties.updateParty(env.DB, guildId, id, { requesterId: OWNER, maxSize: 4 }, policy)
    expect(expanded.promoted).toEqual([])
    expect(expanded.data!.queue.map(m => m.userId)).toContain(BAD)
  })

  it('allows leaving during a Discord outage without promoting unchecked users', async () => {
    const { id, guildId, policy } = await make()
    await parties.joinParty(env.DB, guildId, id, user(ACTIVE), policy)
    await parties.joinParty(env.DB, guildId, id, user(GOOD), policy)
    failure = 429
    const result = await parties.leaveParty(env.DB, guildId, id, ACTIVE, 'left', policy)
    expect(result.status).toBe('left')
    expect(result.promoted).toBeUndefined()
  })

  it('sweeps revoked queued and active members but preserves state during outages', async () => {
    const { id, guildId, bindings } = await make()
    await parties.joinParty(env.DB, guildId, id, user(ACTIVE))
    await parties.joinParty(env.DB, guildId, id, user(BAD))
    await parties.joinParty(env.DB, guildId, id, user(GOOD))
    approved.delete(ACTIVE)
    failure = 500
    await sweepRulesApproval(bindings)
    expect((await parties.getParty(env.DB, guildId, id))!.queue).toHaveLength(2)
    failure = 0
    await sweepRulesApproval(bindings)
    const result = (await parties.getParty(env.DB, guildId, id))!
    expect(result.members.map(m => m.userId)).toEqual([OWNER, GOOD])
    expect(result.queue).toHaveLength(0)
  })

  it('closes a revoked owner party without deleting other players', async () => {
    const { id, guildId, bindings } = await make()
    await parties.joinParty(env.DB, guildId, id, user(GOOD))
    approved.delete(OWNER)
    await sweepRulesApproval(bindings)
    const party = (await parties.getParty(env.DB, guildId, id))!
    expect(party.isClosed).toBe(true)
    expect(party.members.map(m => m.userId)).toContain(GOOD)
  })
})

describe('entry routes', () => {
  it.each([handleJoinButton, handleQueueButton])('denies an unapproved button interaction', async handler => {
    const { id, guildId, bindings } = await make()
    const followup = vi.fn()
    const c: any = { env: bindings, interaction: { guild_id: guildId, data: { custom_id: id }, member: { user: { id: BAD, username: 'Bad' } } }, followup }
    c.ephemeral = () => c
    c.resDefer = async (fn: any) => fn(c)
    await handler(c)
    expect(followup).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('rules check'), flags: 64 }))
    expect((await parties.getParty(env.DB, guildId, id))!.members).toHaveLength(1)
  })

  it('admin add cannot bypass the role', async () => {
    const { id, guildId, bindings } = await make()
    const url = new URL(`https://bot.test/admin/api/parties/${id}/members?guild=${guildId}`)
    const res = await handleAdminApi(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: BAD }) }), bindings, url, 'boss@example.com')
    expect(res.status).toBe(403)
    expect(await res.text()).toContain('rules check')
  })

  it('desktop add is gated and invitation roster excludes revoked members', async () => {
    const { id, guildId, bindings } = await make(4)
    const token = await createClientToken(env.DB, { guildId, discordUserId: OWNER, displayName: 'Owner' })
    const request = (path: string, body?: unknown) => {
      const url = new URL('https://bot.test' + path)
      return handleClientApi(new Request(url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), bindings, url)
    }
    expect((await request('/client/party/add', { userId: BAD })).status).toBe(403)
    await parties.joinParty(env.DB, guildId, id, user(BAD))
    await parties.joinParty(env.DB, guildId, id, user(GOOD))
    const response = await request('/client/session?verifyRules=1')
    const data = await response.json<any>()
    expect(data.party.members.map((m: any) => m.userId)).toEqual([OWNER, GOOD])
    approved.delete(OWNER)
    const revoked = await (await request('/client/session?verifyRules=1')).json<any>()
    expect(revoked.canInvite).toBe(false)
    expect(revoked.party).toBeNull()
  })
})
