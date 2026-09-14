import { env } from 'cloudflare:test'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { handleAdminApi } from '../src/admin/api'
import { handleAdmin } from '../src/admin'
import { rulesAccess } from '../src/lib/rules'

const G = '777770000000000001'
const ROLE = '777770000000000002'
const original = globalThis.fetch
let upstream: ReturnType<typeof vi.fn>
const bindings = () => ({ ...env, RULES_BOT_API_URL: 'https://rules.example.test', RULES_BOT_API_TOKEN: 'private-bridge-secret' })
beforeEach(() => {
  upstream = vi.fn(async () => Response.json({ guildId: G, roleId: ROLE, channelId: '777770000000000003', online: true, config: { version: '1' }, counts: {} }))
  globalThis.fetch = upstream as any
})
afterEach(() => { globalThis.fetch = original })

async function request(path: string, method = 'GET', body: any = {}, email = `12345@${G}.discord.local`, guild = G, extra: Record<string, string> = {}) {
  const url = new URL(`https://party.example.test/admin/api/rules/${path}?guild=${guild}`)
  return handleAdminApi(new Request(url, { method, headers: { 'Content-Type': 'application/json', ...extra }, body: method === 'GET' ? undefined : JSON.stringify(body) }), bindings(), url, email)
}

it('allows an existing guild admin without revealing secrets', async () => {
  const res = await request('status')
  expect(res.status).toBe(200)
  expect(await res.text()).not.toContain('private-bridge-secret')
  const [, init] = upstream.mock.calls[0] as any
  expect(init.headers.Authorization).toBe('Bearer private-bridge-secret')
  expect(init.headers['X-Arena-Guild']).toBe(G)
})

it('rejects cross-guild access before contacting the bot', async () => {
  const res = await request('status', 'GET', {}, '12345@88888.discord.local')
  expect(res.status).toBe(403)
  expect(upstream).not.toHaveBeenCalled()
})

it('rejects unauthenticated requests at the existing admin boundary', async () => {
  const res = await handleAdmin(new Request(`https://party.example.test/admin/api/rules/status?guild=${G}`), { ...bindings(), CF_ACCESS_TEAM: 'team', CF_ACCESS_AUD: 'aud' })
  expect(res.status).toBe(403)
  expect(upstream).not.toHaveBeenCalled()
})

it('connects the queue using the bot role, not an arbitrary browser role', async () => {
  const res = await request('connect', 'POST', { roleId: 'evil' })
  expect(res.status).toBe(200)
  expect((await res.json<any>()).queueConnected).toBe(true)
  const row = await env.DB.prepare('SELECT role_id FROM rules_gate WHERE guild_id=?1').bind(G).first<{ role_id: string }>()
  expect(row!.role_id).toBe(ROLE)
  upstream.mockImplementation(async () => Response.json({ roles: [] }))
  await expect(rulesAccess(bindings()).require(G, '99999')).rejects.toThrow('rules check')
})

it('forwards the authenticated actor and keeps pending actions visible', async () => {
  upstream.mockImplementation(async () => Response.json({ ok: true, pending: true, message: 'Removal pending' }, { status: 202 }))
  const res = await request('members/123456789012345678/revoke', 'POST', { reason: 'Conduct', actor: 'spoofed' })
  expect(res.status).toBe(202)
  const [, init] = upstream.mock.calls[0] as any
  expect(init.headers['X-Arena-Actor']).toBe(`12345@${G}.discord.local`)
  expect(JSON.parse(init.body).reason).toBe('Conduct')
})

it('rejects unknown proxy paths and cross-origin writes', async () => {
  expect((await request('secrets')).status).toBe(404)
  expect((await request('publish', 'POST', {}, undefined, G, { Origin: 'https://evil.test' })).status).toBe(403)
  expect(upstream).not.toHaveBeenCalled()
})

it('reports missing setup without exposing environment values', async () => {
  const url = new URL(`https://party.example.test/admin/api/rules/status?guild=${G}`)
  const res = await handleAdminApi(new Request(url), env, url, `12345@${G}.discord.local`)
  expect(res.status).toBe(503)
  expect(await res.text()).toContain('one-time connection')
})

it('rejects a service configured for a different server', async () => {
  upstream.mockImplementation(async () => Response.json({ guildId: 'wrong', roleId: ROLE }))
  expect((await request('connect', 'POST')).status).toBe(503)
})

it('proxies the tracked-member roster read-only', async () => {
  upstream = vi.fn(async () => Response.json({ members: [{ user_id: '1', state: 'approved', revocations: 0, completions: 1, version: '1' }] }))
  globalThis.fetch = upstream as any

  const listed = await request('members')
  expect(listed.status).toBe(200)
  expect((await listed.json<any>()).members).toHaveLength(1)
  expect((upstream.mock.calls[0] as any)[0]).toContain('/members')

  // The roster is a read; writes to it are not a route.
  expect((await request('members', 'POST')).status).toBe(404)
  expect((await request('members', 'DELETE')).status).toBe(404)
})
