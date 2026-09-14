import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as parties from '../src/store/parties'
import { rulesAccess } from '../src/lib/rules'
import { sweepRulesApproval } from '../src/lib/rules-sweep'
import { handleClientApi } from '../src/client-api'
import { createClientToken } from '../src/store/clientAuth'
import { handleAdminApi } from '../src/admin/api'
import { handleJoinButton, handleQueueButton } from '../src/components/buttons'
import { revokeApproval, saveRulesGate } from '../src/store/rules'

// The queue gate. What is gated has not changed; where approval comes from
// has. It used to be a Discord role read back over the API for every member on
// every check, which meant Discord being slow or unreachable was a failure mode
// the queue had to survive. Approval is a row in this database now, so those
// paths are gone rather than fixed — hence the assertion that a gate check
// makes no Discord calls at all.

const G = '100000000000000000'
const OWNER = '300000000000000000'
const BAD = '400000000000000000'
const GOOD = '500000000000000000'
const ACTIVE = '600000000000000000'
const user = (id: string) => ({ userId: id, username: id, displayName: id })

let seq = 0
let discord: ReturnType<typeof vi.fn>
const originalFetch = globalThis.fetch

beforeEach(() => {
  discord = vi.fn(async (input: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    // Adds resolve the target's name through Discord; approval no longer does.
    if (url.pathname.includes('/members/')) {
      const id = url.pathname.split('/').pop()!
      return Response.json({ user: { id, username: id }, nick: id, roles: [] })
    }
    return Response.json({ id: 'message', channel_id: 'channel' })
  })
  globalThis.fetch = discord as any
})
afterEach(() => { globalThis.fetch = originalFetch })

async function approve(guildId: string, ...ids: string[]) {
  for (const id of ids) {
    await env.DB.prepare(`
      INSERT INTO rules_members (guild_id, user_id, state, generation, revocations, completions, version, accepted_at)
      VALUES (?1, ?2, 'approved', 0, 0, 1, 1, ?3)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET state = 'approved'
    `).bind(guildId, id, Date.now()).run()
  }
}

const revoke = (guildId: string, id: string) =>
  revokeApproval(env.DB, guildId, id, 'moderator', 'Test revocation', true, false)

/** A gated guild with a party owned by an approved OWNER. */
async function make(maxSize = 2) {
  const id = `R${seq++}`
  const guildId = String(BigInt(G) + BigInt(seq))
  await saveRulesGate(env.DB, guildId, { enabled: true })
  await approve(guildId, OWNER, GOOD, ACTIVE)
  const policy = rulesAccess(env)
  await parties.createParty(env.DB, {
    id, guildId, name: 'Arena', description: '', game: 'Other', owner: user(OWNER), maxSize,
  }, policy)
  return { id, guildId, policy }
}

describe('rules approval policy', () => {
  it('allows the approved, denies everyone else, and never caches', async () => {
    const { guildId } = await make()
    const policy = rulesAccess(env)
    await policy.require(guildId, GOOD)
    await revoke(guildId, GOOD)
    await expect(policy.require(guildId, GOOD)).rejects.toThrow('rules check')
  })

  it('checks approval without calling Discord at all', async () => {
    const { guildId } = await make()
    await rulesAccess(env).eligible(guildId, [OWNER, GOOD, BAD, ACTIVE])
    expect(discord).not.toHaveBeenCalled()
  })

  it('leaves a guild with the gate off alone', async () => {
    const off = String(BigInt(G) + 9000n)
    await rulesAccess(env).require(off, BAD)
    await saveRulesGate(env.DB, off, { enabled: false })
    await rulesAccess(env).require(off, BAD)
  })

  it('gates each guild on its own approvals', async () => {
    const a = await make()
    const b = await make()
    await revoke(b.guildId, GOOD)
    await rulesAccess(env).require(a.guildId, GOOD)
    await expect(rulesAccess(env).require(b.guildId, GOOD)).rejects.toThrow('rules check')
  })
})

describe('queue operations', () => {
  it('gates party creators, direct joins, and owner force-adds', async () => {
    const { id, guildId, policy } = await make(4)
    await expect(parties.createParty(env.DB, {
      id: 'BAD', guildId, name: 'x', description: '', game: 'Other', owner: user(BAD), maxSize: 4,
    }, policy)).rejects.toThrow('rules check')
    await expect(parties.joinParty(env.DB, guildId, id, user(BAD), policy)).rejects.toThrow('rules check')
    await expect(parties.forceAdd(env.DB, guildId, id, OWNER, user(BAD), policy)).rejects.toThrow('rules check')
    expect((await parties.getParty(env.DB, guildId, id))!.members).toHaveLength(1)
    expect((await parties.joinParty(env.DB, guildId, id, user(GOOD), policy)).status).toBe('joined')
  })

  it('gates manual queue approval and ownership transfer', async () => {
    const { id, guildId, policy } = await make(4)
    await parties.joinParty(env.DB, guildId, id, user(BAD))  // pre-gate member
    await expect(parties.promoteOwner(env.DB, guildId, id, OWNER, BAD, policy)).rejects.toThrow('rules check')
    await parties.closeParty(env.DB, guildId, id, OWNER)
    await parties.joinParty(env.DB, guildId, id, user(GOOD), policy)
    await revoke(guildId, GOOD)
    await expect(parties.approveQueued(env.DB, guildId, id, OWNER, GOOD, policy)).rejects.toThrow('rules check')
  })

  it('skips unapproved queue entries on leave and preserves FIFO champion bans', async () => {
    const { id, guildId, policy } = await make()
    await parties.joinParty(env.DB, guildId, id, user(ACTIVE), policy)
    await parties.joinParty(env.DB, guildId, id, user(BAD))
    await parties.joinParty(env.DB, guildId, id, user(GOOD))
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
    await parties.joinParty(env.DB, guildId, id, user(GOOD))
    const result = await parties.openParty(env.DB, guildId, id, OWNER, policy)
    expect(result.promoted).toEqual([GOOD])
    const expanded = await parties.updateParty(env.DB, guildId, id, { requesterId: OWNER, maxSize: 4 }, policy)
    expect(expanded.promoted).toEqual([])
    expect(expanded.data!.queue.map(m => m.userId)).toContain(BAD)
  })

  it('sweeps members and queue entries whose approval went away', async () => {
    const { id, guildId } = await make()
    await parties.joinParty(env.DB, guildId, id, user(ACTIVE))
    await parties.joinParty(env.DB, guildId, id, user(BAD))
    await parties.joinParty(env.DB, guildId, id, user(GOOD))

    await revoke(guildId, ACTIVE)
    await sweepRulesApproval(env)

    const result = (await parties.getParty(env.DB, guildId, id))!
    expect(result.members.map(m => m.userId)).toEqual([OWNER, GOOD])
    expect(result.queue).toHaveLength(0)
  })

  it('closes a revoked owner party without deleting other players', async () => {
    const { id, guildId } = await make()
    await parties.joinParty(env.DB, guildId, id, user(GOOD))
    await revoke(guildId, OWNER)
    await sweepRulesApproval(env)
    const party = (await parties.getParty(env.DB, guildId, id))!
    expect(party.isClosed).toBe(true)
    expect(party.members.map(m => m.userId)).toContain(GOOD)
  })
})

describe('entry routes', () => {
  it.each([handleJoinButton, handleQueueButton])('denies an unapproved button interaction', async handler => {
    const { id, guildId } = await make()
    const followup = vi.fn()
    const c: any = {
      env,
      interaction: { guild_id: guildId, data: { custom_id: id }, member: { user: { id: BAD, username: 'Bad' } } },
      followup,
    }
    c.ephemeral = () => c
    c.resDefer = async (fn: any) => fn(c)
    await handler(c)
    expect(followup).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('rules check'), flags: 64,
    }))
    expect((await parties.getParty(env.DB, guildId, id))!.members).toHaveLength(1)
  })

  it('admin add cannot bypass the gate', async () => {
    const { id, guildId } = await make()
    const url = new URL(`https://bot.test/admin/api/parties/${id}/members?guild=${guildId}`)
    const res = await handleAdminApi(
      new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: BAD }) }),
      env, url, 'boss@example.com',
    )
    expect(res.status).toBe(403)
    expect(await res.text()).toContain('rules check')
  })

  it('desktop add is gated and the invite roster drops the unapproved', async () => {
    const { id, guildId } = await make(4)
    const token = await createClientToken(env.DB, { guildId, discordUserId: OWNER, displayName: 'Owner' })
    const request = (path: string, body?: unknown) => {
      const url = new URL('https://bot.test' + path)
      return handleClientApi(new Request(url, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      }), env, url)
    }

    expect((await request('/client/party/add', { userId: BAD })).status).toBe(403)
    await parties.joinParty(env.DB, guildId, id, user(BAD))
    await parties.joinParty(env.DB, guildId, id, user(GOOD))

    const data = await (await request('/client/session?verifyRules=1')).json<any>()
    expect(data.party.members.map((m: any) => m.userId)).toEqual([OWNER, GOOD])

    await revoke(guildId, OWNER)
    const revoked = await (await request('/client/session?verifyRules=1')).json<any>()
    expect(revoked.canInvite).toBe(false)
    expect(revoked.party).toBeNull()
  })
})
