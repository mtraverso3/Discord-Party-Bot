import { env } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import { handleAdminApi } from '../src/admin/api'
import { MAINTENANCE_MESSAGE, maintenanceUntil, resetMaintenanceCache } from '../src/lib/maintenance'
import * as parties from '../src/store/parties'

let keys: CryptoKeyPair
let publicKeyHex: string
beforeAll(async () => {
  keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey) as ArrayBuffer)
  publicKeyHex = [...raw].map(b => b.toString(16).padStart(2, '0')).join('')
})

const original = globalThis.fetch
beforeEach(() => {
  resetMaintenanceCache()
  globalThis.fetch = vi.fn(async () => Response.json({ id: 'posted', channel_id: 'chan' })) as any
})
afterEach(async () => {
  globalThis.fetch = original
  await env.DB.prepare('DELETE FROM system_state').run()
  resetMaintenanceCache()
})

const testEnv = () => ({ ...env, DISCORD_PUBLIC_KEY: publicKeyHex })
const ctx = () => {
  const pending: Promise<unknown>[] = []
  return { pending, waitUntil: (p: Promise<unknown>) => { pending.push(p) }, passThroughOnException() {} } as any
}

async function maintenance(untilMs: number) {
  await env.DB.prepare(`
    INSERT INTO system_state (key, value) VALUES ('maintenance_until', ?1)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value
  `).bind(String(untilMs)).run()
  resetMaintenanceCache()
}

async function interaction(body: unknown) {
  const text = JSON.stringify(body)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(timestamp + text)))
  const req = new Request('https://party.example.test/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-signature-ed25519': [...sig].map(b => b.toString(16).padStart(2, '0')).join(''),
      'x-signature-timestamp': timestamp,
    },
    body: text,
  })
  return (await worker.fetch(req, testEnv(), ctx())).json<any>()
}

const command = {
  type: 2, guild_id: '1', channel_id: '2', token: 't',
  member: { user: { id: '3', username: 'u' }, permissions: '0' },
  data: { name: 'party', options: [{ type: 1, name: 'list' }] },
}

describe('maintenance mode', () => {
  it('is off with no flag, or an expired one', async () => {
    expect(await maintenanceUntil(env.DB)).toBe(0)
    await maintenance(Date.now() - 1000)
    expect(await maintenanceUntil(env.DB)).toBeLessThan(Date.now())
    const client = await worker.fetch(new Request('https://party.example.test/client/session'), testEnv(), ctx())
    expect(client.status).toBe(401)
  })

  it('answers commands, buttons and modals with a private "updating" reply', async () => {
    await maintenance(Date.now() + 60_000)
    for (const type of [2, 3, 5]) {
      expect(await interaction({ ...command, type })).toEqual({ type: 4, data: { content: MAINTENANCE_MESSAGE, flags: 64 } })
    }
  })

  it('still answers pings, and offers no autocomplete', async () => {
    await maintenance(Date.now() + 60_000)
    expect(await interaction({ type: 1 })).toEqual({ type: 1 })
    expect(await interaction({ type: 4, guild_id: '1', data: { name: 'party', options: [] } }))
      .toEqual({ type: 8, data: { choices: [] } })
  })

  it('pauses the client and admin APIs with a 503 that says when to come back', async () => {
    await maintenance(Date.now() + 30_000)
    const client = await worker.fetch(new Request('https://party.example.test/client/session'), testEnv(), ctx())
    expect(client.status).toBe(503)
    expect(Number(client.headers.get('retry-after'))).toBeGreaterThanOrEqual(25)
    expect((await client.json<any>()).error).toBe(MAINTENANCE_MESSAGE)

    const url = new URL('https://party.example.test/admin/api/settings?guild=g')
    const admin = await handleAdminApi(new Request(url), env, url, 'boss@example.com')
    expect(admin.status).toBe(503)
  })

  it('skips the cron sweeps until it ends', async () => {
    const g = 'maint-guild'
    await parties.createParty(env.DB, {
      id: 'MNT001', guildId: g, name: 'Idle', description: '', game: 'Other',
      owner: { userId: 'o', username: 'o', displayName: 'O' }, maxSize: 5,
    })
    await env.DB.prepare('UPDATE parties SET last_activity_at = 0 WHERE guild_id = ?1').bind(g).run()

    await maintenance(Date.now() + 60_000)
    let c = ctx()
    await worker.scheduled({ cron: '*/15 * * * *' } as any, testEnv(), c)
    await Promise.all(c.pending)
    expect(await parties.getParty(env.DB, g, 'MNT001')).not.toBeNull()

    await env.DB.prepare('DELETE FROM system_state').run()
    resetMaintenanceCache()
    c = ctx()
    await worker.scheduled({ cron: '*/15 * * * *' } as any, testEnv(), c)
    await Promise.all(c.pending)
    expect(await parties.getParty(env.DB, g, 'MNT001')).toBeNull()
  })

  it('reads the flag at most every few seconds', async () => {
    const now = Date.now()
    expect(await maintenanceUntil(env.DB, now)).toBe(0)
    await env.DB.prepare("INSERT INTO system_state (key, value) VALUES ('maintenance_until', ?1)").bind(String(now + 60_000)).run()
    expect(await maintenanceUntil(env.DB, now + 1000)).toBe(0)
    expect(await maintenanceUntil(env.DB, now + 6000)).toBe(now + 60_000)
  })
})
