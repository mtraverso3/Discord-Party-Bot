import { env } from 'cloudflare:test'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as parties from '../src/store/parties'
import { rulesAccess } from '../src/lib/rules'
import { sweepRulesApproval } from '../src/lib/rules-sweep'
import { handleAdminApi } from '../src/admin/api'
import { getRulesGate } from '../src/store/rules'
import { sweepStaleSessions } from '../src/store/rules'

// Deploying this must change nothing for a server that has not asked for a
// rules check. Every guarantee below is one that, if it broke, would start
// refusing members who were joining fine the day before — so each is pinned
// here rather than left to the absence of a row.

let seq = 0
const guild = () => String(400000000000000000n + BigInt(++seq))
const user = (id: string) => ({ userId: id, username: id, displayName: id })
const OWNER = '410000000000000001'
const OTHER = '410000000000000002'

const original = globalThis.fetch
beforeEach(() => { globalThis.fetch = vi.fn(async () => Response.json({ id: 'm', channel_id: 'c' })) as any })
afterEach(() => { globalThis.fetch = original })

it('leaves a guild that has never touched the rules tab ungated', async () => {
  const g = guild()
  expect(await getRulesGate(env.DB, g)).toBeNull()

  const policy = rulesAccess(env)
  // null, not [] — "no gate here", which every caller treats as no check.
  expect(await policy.eligible(g, [OWNER, OTHER])).toBeNull()
  await policy.require(g, OWNER)
})

it('lets parties run exactly as before', async () => {
  const g = guild()
  const policy = rulesAccess(env)
  const created = await parties.createParty(env.DB, {
    id: 'DEF001', guildId: g, name: 'Open', description: '', game: 'Other',
    owner: user(OWNER), maxSize: 4,
  }, policy)
  expect(created.ok).toBe(true)
  expect((await parties.joinParty(env.DB, g, 'DEF001', user(OTHER), policy)).status).toBe('joined')
})

it('runs the every-minute sweep over an ungated guild without touching it', async () => {
  const g = guild()
  await parties.createParty(env.DB, {
    id: 'DEF002', guildId: g, name: 'Open', description: '', game: 'Other',
    owner: user(OWNER), maxSize: 4,
  }, rulesAccess(env))
  await parties.joinParty(env.DB, g, 'DEF002', user(OTHER), rulesAccess(env))

  // The whole minute's work, as the cron runs it.
  await sweepRulesApproval(env)
  await sweepStaleSessions(env.DB)

  const party = (await parties.getParty(env.DB, g, 'DEF002'))!
  expect(party.members.map(m => m.userId)).toEqual([OWNER, OTHER])
  expect(party.isClosed).toBe(false)
})

it('does not switch the gate on as a side effect of posting the Start button', async () => {
  const g = guild()
  const url = new URL(`https://p.test/admin/api/rules/post?guild=${g}`)
  const res = await handleAdminApi(new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId: '700000000000000001' }),
  }), env, url, `1@${g}.discord.local`)
  expect(res.status).toBe(200)

  // The button is up, but nobody is being refused until an admin says so.
  expect((await getRulesGate(env.DB, g))?.enabled).toBe(false)
  await rulesAccess(env).require(g, OTHER)
})

it('reports itself as not required until someone turns it on', async () => {
  const g = guild()
  const url = new URL(`https://p.test/admin/api/rules/status?guild=${g}`)
  const body = await (await handleAdminApi(new Request(url), env, url, `1@${g}.discord.local`)).json<any>()
  expect(body.queueConnected).toBe(false)
  expect(body.defaultRequired).toBe(false)
  expect(body.counts).toEqual({ total: 0, approved: 0 })
})
