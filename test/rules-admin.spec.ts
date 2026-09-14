import { env } from 'cloudflare:test'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { handleAdminApi } from '../src/admin/api'
import { handleAdmin } from '../src/admin'
import { getRulesConfig, getRulesGate, saveRulesGate } from '../src/store/rules'
import { rulesAccess } from '../src/lib/rules'

// The dashboard's rules routes. These used to proxy to a Python service over a
// tunnel; they read and write this Worker's own database now, so what is worth
// asserting shifted from "the bridge is used correctly" to "the state changes
// correctly". Access and guild scoping are unchanged and still checked here.

let seq = 0
const guild = () => String(100000000000000000n + BigInt(++seq))
const MEMBER = '500000000000000001'

const original = globalThis.fetch
let discord: ReturnType<typeof vi.fn>

beforeEach(() => {
  discord = vi.fn(async () => Response.json({ id: 'posted', channel_id: 'chan' }))
  globalThis.fetch = discord as any
})
afterEach(() => { globalThis.fetch = original })

function call(path: string, guildId: string, method = 'GET', body?: unknown, email = `12345@${guildId}.discord.local`) {
  const url = new URL(`https://party.example.test/admin/api/rules/${path}?guild=${guildId}`)
  return handleAdminApi(
    new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    }),
    env, url, email,
  )
}

const publish = async (guildId: string, config: any, expectedVersion: number, requireReapproval = false) =>
  call('publish', guildId, 'POST', { config, expectedVersion, requireReapproval })

const CONFIG = {
  pages: [{ title: 'Rules', text: 'Be excellent.' }],
  questions: [{ text: 'Ready?', correct: ['Yes'], incorrect: ['No'], explanation: 'Good.' }],
  agreement: 'I agree.',
}

it('serves the built-in rules until a guild publishes its own', async () => {
  const g = guild()
  const res = await call('status', g)
  expect(res.status).toBe(200)
  const body = await res.json<any>()
  expect(body.online).toBe(true)
  expect(body.queueConnected).toBe(false)
  expect(body.config.version).toBe(1)
  expect(body.config.pages.length).toBeGreaterThan(0)
  expect(body.counts).toEqual({ total: 0, approved: 0 })
})

it('rejects cross-guild access', async () => {
  const g = guild()
  expect((await call('status', g, 'GET', undefined, '12345@88888.discord.local')).status).toBe(403)
})

it('rejects unauthenticated requests at the admin boundary', async () => {
  const g = guild()
  const res = await handleAdmin(
    new Request(`https://party.example.test/admin/api/rules/status?guild=${g}`),
    { ...env, CF_ACCESS_TEAM: 'team', CF_ACCESS_AUD: 'aud' },
  )
  expect(res.status).toBe(403)
})

it('switches the gate on, and off again, from the dashboard', async () => {
  const g = guild()
  await rulesAccess(env).require(g, MEMBER)  // ungated: anyone passes

  const connected = await (await call('connect', g, 'POST')).json<any>()
  expect(connected.queueConnected).toBe(true)
  await expect(rulesAccess(env).require(g, MEMBER)).rejects.toThrow('rules check')

  await saveRulesGate(env.DB, g, { enabled: false })
  await rulesAccess(env).require(g, MEMBER)
})

it('publishes a new version and refuses a stale editor', async () => {
  const g = guild()
  const first = await publish(g, CONFIG, 1)
  expect(first.status).toBe(200)
  expect((await first.json<any>()).version).toBe(2)
  expect((await getRulesConfig(env.DB, g)).agreement).toBe('I agree.')

  // A second editor still holding version 1 must reload rather than overwrite.
  const stale = await publish(g, { ...CONFIG, agreement: 'Mine.' }, 1)
  expect(stale.status).toBe(409)
  expect((await getRulesConfig(env.DB, g)).agreement).toBe('I agree.')
})

it('refuses what it should not store', async () => {
  // One guild for all of these: each is rejected, so the version never moves.
  const g = guild()
  const bad = (config: any) => publish(g, config, 1)
  expect((await bad({ ...CONFIG, pages: [] })).status).toBe(400)
  expect((await bad({ ...CONFIG, pages: Array(9).fill(CONFIG.pages[0]) })).status).toBe(400)
  expect((await bad({ ...CONFIG, questions: [{ ...CONFIG.questions[0], correct: [] }] })).status).toBe(400)
  expect((await bad({ ...CONFIG, questions: [{ ...CONFIG.questions[0], incorrect: Array(5).fill('x') }] })).status).toBe(400)
  expect((await bad({ ...CONFIG, questions: [{ ...CONFIG.questions[0], correct: ['a'], incorrect: ['A'] }] })).status).toBe(400)
  expect((await bad({ ...CONFIG, agreement: '' })).status).toBe(400)
  expect((await getRulesConfig(env.DB, g)).version).toBe(1)
})

it('accepts a quiz of any length, including none at all', async () => {
  // A fresh guild each time: a successful publish moves the version on.
  const empty = guild()
  expect((await publish(empty, { ...CONFIG, questions: [] }, 1)).status).toBe(200)
  expect((await getRulesConfig(env.DB, empty)).questions).toEqual([])

  const long = guild()
  const many = Array.from({ length: 40 }, (_, i) => ({
    ...CONFIG.questions[0], text: `Question ${i + 1}?`,
  }))
  expect((await publish(long, { ...CONFIG, questions: many }, 1)).status).toBe(200)
  expect((await getRulesConfig(env.DB, long)).questions).toHaveLength(40)
})

it('requires everyone to verify again only when asked', async () => {
  const g = guild()
  await call('connect', g, 'POST')
  await env.DB.prepare(`
    INSERT INTO rules_members (guild_id, user_id, state, generation, revocations, completions, version, accepted_at)
    VALUES (?1, ?2, 'approved', 0, 0, 1, 1, ?3)
  `).bind(g, MEMBER, Date.now()).run()

  const quiet = await (await publish(g, CONFIG, 1)).json<any>()
  expect(quiet.message).toContain('stay valid')
  await rulesAccess(env).require(g, MEMBER)

  const reset = await (await publish(g, CONFIG, 2, true)).json<any>()
  expect(reset.message).toContain('1 member(s)')
  await expect(rulesAccess(env).require(g, MEMBER)).rejects.toThrow('rules check')
})

it('posts the start message to a channel and remembers it', async () => {
  const g = guild()
  expect((await call('post', g, 'POST')).status).toBe(400)  // no channel known yet

  const res = await call('post', g, 'POST', { channelId: '700000000000000001' })
  expect(res.status).toBe(200)
  expect((await getRulesGate(env.DB, g))?.channelId).toBe('700000000000000001')

  const [url, init] = discord.mock.calls[0] as any
  expect(url).toContain('/channels/700000000000000001/messages')
  expect(JSON.parse(init.body).components[0].components[0].custom_id).toContain('rules_start')
})

it('counts a revocation only when it takes away a live approval', async () => {
  const g = guild()
  await call('connect', g, 'POST')
  await env.DB.prepare(`
    INSERT INTO rules_members (guild_id, user_id, state, generation, revocations, completions, version, accepted_at)
    VALUES (?1, ?2, 'approved', 0, 0, 1, 1, ?3)
  `).bind(g, MEMBER, Date.now()).run()

  const revoked = await (await call(`members/${MEMBER}/revoke`, g, 'POST', { reason: 'Left mid-series' })).json<any>()
  expect(revoked.message).toContain('increased by 1')
  await expect(rulesAccess(env).require(g, MEMBER)).rejects.toThrow('rules check')

  // Revoking again, with nothing to take away, must not keep counting.
  const again = await (await call(`members/${MEMBER}/revoke`, g, 'POST', { reason: 'Same again' })).json<any>()
  expect(again.message).toContain('unchanged')

  // A reset never counts, and the reason is required either way.
  expect((await call(`members/${MEMBER}/reset`, g, 'POST', { reason: '' })).status).toBe(400)
  const reset = await (await call(`members/${MEMBER}/reset`, g, 'POST', { reason: 'New season' })).json<any>()
  expect(reset.message).toContain('No disciplinary count')

  const detail = await (await call(`members/${MEMBER}`, g)).json<any>()
  expect(detail.member.revocations).toBe(1)
  expect(detail.history.map((e: any) => e.kind)).toEqual(['reset', 'reset', 'revoked'])
  expect(detail.history[2].reason).toContain('Left mid-series')
})

it('lists tracked members, read-only', async () => {
  const g = guild()
  await env.DB.prepare(`
    INSERT INTO rules_members (guild_id, user_id, state, generation, revocations, completions, version, accepted_at)
    VALUES (?1, ?2, 'approved', 0, 2, 3, 1, ?3)
  `).bind(g, MEMBER, Date.now()).run()

  const listed = await (await call('members', g)).json<any>()
  expect(listed.members).toEqual([
    { user_id: MEMBER, state: 'approved', revocations: 2, completions: 3, version: '1' },
  ])
  expect((await call('members', g, 'POST')).status).toBe(404)
})

it('rejects unknown routes and cross-origin writes', async () => {
  const g = guild()
  expect((await call('nope', g)).status).toBe(404)

  const url = new URL(`https://party.example.test/admin/api/rules/connect?guild=${g}`)
  const res = await handleAdminApi(
    new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://evil.test' }, body: '{}' }),
    env, url, `12345@${g}.discord.local`,
  )
  expect(res.status).toBe(403)
  expect((await getRulesGate(env.DB, g))?.enabled).toBeUndefined()
})
