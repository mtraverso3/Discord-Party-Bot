import { env } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'
import * as parties from '../src/store/parties'

// The Worker's front door: Discord's signature check, routing, and the crons.

let keys: CryptoKeyPair
let publicKeyHex: string
beforeAll(async () => {
  keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey) as ArrayBuffer)
  publicKeyHex = [...raw].map(b => b.toString(16).padStart(2, '0')).join('')
})

let calls: Array<{ url: string; method: string; body: any }>
const original = globalThis.fetch
beforeEach(() => {
  calls = []
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null })
    return Response.json({ id: 'posted', channel_id: 'chan' })
  }) as any
})
afterEach(() => { globalThis.fetch = original })

function ctx() {
  const pending: Promise<unknown>[] = []
  return { pending, waitUntil: (p: Promise<unknown>) => { pending.push(p) }, passThroughOnException() {} } as any
}

const testEnv = () => ({ ...env, DISCORD_PUBLIC_KEY: publicKeyHex })

async function signed(body: unknown, opts: { tamper?: boolean; noHeaders?: boolean } = {}) {
  const text = JSON.stringify(body)
  const timestamp = String(Math.floor(Date.now() / 1000))
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(timestamp + text)))
  const hex = [...sig].map(b => b.toString(16).padStart(2, '0')).join('')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (!opts.noHeaders) {
    headers['x-signature-ed25519'] = opts.tamper ? hex.replace(/^./, c => (c === '0' ? '1' : '0')) : hex
    headers['x-signature-timestamp'] = timestamp
  }
  return new Request('https://party.example.test/', { method: 'POST', headers, body: text })
}

let seq = 0
const guild = () => String(800000000000000000n + BigInt(++seq))

describe('interactions endpoint', () => {
  it('answers a signed ping', async () => {
    const res = await worker.fetch(await signed({ type: 1 }), testEnv(), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ type: 1 })
  })

  it('refuses unsigned and tampered requests', async () => {
    expect((await worker.fetch(await signed({ type: 1 }, { noHeaders: true }), testEnv(), ctx())).status).toBe(401)
    expect((await worker.fetch(await signed({ type: 1 }, { tamper: true }), testEnv(), ctx())).status).toBe(401)
  })

  it('answers /party ign autocomplete directly', async () => {
    const res = await worker.fetch(await signed({
      type: 4, guild_id: guild(),
      data: { name: 'party', options: [{ type: 1, name: 'ign', options: [{ name: 'game', value: 'lol', focused: true }] }] },
    }), testEnv(), ctx())
    const body = await res.json<any>()
    expect(body.type).toBe(8)
    expect(body.data.choices.map((c: any) => c.value)).toContain('LoL NA')
  })

  it('defers a create-party modal and creates the party in the background', async () => {
    const g = guild()
    const c = ctx()
    const res = await worker.fetch(await signed({
      type: 5, guild_id: g, channel_id: '700000000000000001', token: 'tok',
      member: { user: { id: '810000000000000001', username: 'host' } },
      data: {
        custom_id: 'party_create',
        components: [
          { type: 18, component: { type: 4, custom_id: 'name', value: 'Entry party' } },
          { type: 18, component: { type: 4, custom_id: 'description', value: '' } },
          { type: 18, component: { type: 4, custom_id: 'capacity', value: '5' } },
          { type: 18, component: { type: 3, custom_id: 'game', values: ['Other'] } },
          { type: 18, component: { type: 8, custom_id: 'voice-channel', values: ['700000000000000002'] } },
        ],
      },
    }), testEnv(), c)
    expect(await res.json()).toEqual({ type: 5, data: { flags: 64 } })
    await Promise.all(c.pending)
    expect((await parties.listParties(env.DB, g)).map(p => p.name)).toEqual(['Entry party'])
    expect(calls.find(x => x.url.includes('/webhooks/'))!.body.content).toContain('created')
  })
})

describe('other routes', () => {
  it('serves the landing page', async () => {
    const res = await worker.fetch(new Request('https://party.example.test/'), testEnv(), ctx())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
  })
})

describe('crons', () => {
  it('the 15-minute sweep disbands idle parties and greys out their embed', async () => {
    const g = guild()
    await parties.createParty(env.DB, {
      id: 'IDLE01', guildId: g, name: 'Idle', description: '', game: 'Other',
      owner: { userId: 'o', username: 'o', displayName: 'O' }, maxSize: 5,
    })
    await parties.setEmbedMessage(env.DB, g, 'IDLE01', '900000000000000001', '700000000000000001')
    await env.DB.prepare('UPDATE parties SET last_activity_at = 0 WHERE guild_id = ?1').bind(g).run()

    const c = ctx()
    await worker.scheduled({ cron: '*/15 * * * *' } as any, testEnv(), c)
    await Promise.all(c.pending)
    expect(await parties.getParty(env.DB, g, 'IDLE01')).toBeNull()
    expect(calls.some(x => x.method === 'PATCH' && x.url.includes('/messages/900000000000000001'))).toBe(true)
  })

  it('the every-minute sweep runs without error', async () => {
    const c = ctx()
    await worker.scheduled({ cron: '* * * * *' } as any, testEnv(), c)
    await expect(Promise.all(c.pending)).resolves.toBeDefined()
  })
})
