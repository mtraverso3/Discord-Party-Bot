import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { PartyData } from '../src/types'
import { generateLinkCode, handleClientApi, writeLinkCode } from '../src/client-api'
import { setUserPartyId } from '../src/lib/party'
import { saveGuildSettings, SETTINGS_DEFAULTS } from '../src/lib/settings'

const OWNER = '100000000000000001'
const MEMBER = '100000000000000002'

function req(method: string, path: string, opts: { body?: unknown; token?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`
  const url = new URL(`https://bot.test${path}`)
  const r = new Request(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  return handleClientApi(r, env as any, url)
}

async function linkUser(userId: string, displayName: string, guildId = 'g1'): Promise<string> {
  const code = generateLinkCode()
  await writeLinkCode(env.PARTY_KV, code, { guildId, discordUserId: userId, displayName })
  const res = await req('POST', '/client/auth', { body: { code } })
  expect(res.status).toBe(200)
  const body = await res.json() as any
  expect(body.token).toMatch(/^[0-9a-f]{64}$/)
  return body.token
}

/** Create a party DO at the address the worker derives for (guild, id). */
async function makeParty(guildId: string, partyId: string, ownerId: string, extraMembers: string[] = []) {
  const stub = env.PARTY_STATE.get(env.PARTY_STATE.idFromName(`party-${guildId}-${partyId}`))
  await stub.fetch('http://do/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: partyId, guildId, name: 'Inhouse', description: '', game: 'League of Legends',
      ownerId, ownerUsername: 'owner_un', ownerName: 'Owner', maxSize: 5,
    }),
  })
  for (const m of extraMembers) {
    await stub.fetch('http://do/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: m, username: `${m}_un`, displayName: `User ${m}` }),
    })
  }
  await setUserPartyId(env.PARTY_KV, guildId, ownerId, partyId)
  for (const m of extraMembers) await setUserPartyId(env.PARTY_KV, guildId, m, partyId)
  return stub
}

describe('client auth', () => {
  it('exchanges a link code for a long-lived token, single use', async () => {
    const code = generateLinkCode()
    await writeLinkCode(env.PARTY_KV, code, { guildId: 'g1', discordUserId: OWNER, displayName: 'Owner' })

    const res = await req('POST', '/client/auth', { body: { code } })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.userId).toBe(OWNER)
    expect(body.guildId).toBe('g1')
    expect(body.displayName).toBe('Owner')

    // Code is consumed.
    const again = await req('POST', '/client/auth', { body: { code } })
    expect(again.status).toBe(404)
  })

  it('rejects malformed and unknown codes', async () => {
    expect((await req('POST', '/client/auth', { body: { code: 'short' } })).status).toBe(400)
    expect((await req('POST', '/client/auth', { body: { code: 'ZZZZZZZZ' } })).status).toBe(404)
    expect((await req('POST', '/client/auth', { body: {} })).status).toBe(400)
  })
})

describe('client session', () => {
  it('requires a valid bearer token', async () => {
    expect((await req('GET', '/client/session')).status).toBe(401)
    expect((await req('GET', '/client/session', { token: 'f'.repeat(64) })).status).toBe(401)
    expect((await req('GET', '/client/session', { token: 'nope' })).status).toBe(401)
  })

  it('returns identity with no party when the user is not in one', async () => {
    const token = await linkUser(OWNER, 'Owner', 'g-empty')
    const res = await req('GET', '/client/session', { token })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.userId).toBe(OWNER)
    expect(body.party).toBeNull()
    expect(body.canInvite).toBe(false)
  })

  it('returns the party with member IGNs; owner can invite', async () => {
    const stub = await makeParty('g2', 'LCU001', OWNER, [MEMBER])
    await stub.fetch('http://do/setign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: MEMBER, ign: 'Sniper#NA1' }),
    })

    const token = await linkUser(OWNER, 'Owner', 'g2')
    const body = await (await req('GET', '/client/session', { token })).json() as any
    expect(body.party.id).toBe('LCU001')
    expect(body.party.isOwner).toBe(true)
    expect(body.canInvite).toBe(true)
    const member = body.party.members.find((m: any) => m.userId === MEMBER)
    expect(member.ign).toBe('Sniper#NA1')
    expect(member.isOwner).toBe(false)
  })

  it('non-owners can invite only when allowlisted in guild settings', async () => {
    await makeParty('g3', 'LCU002', OWNER, [MEMBER])
    const token = await linkUser(MEMBER, 'Member', 'g3')

    let body = await (await req('GET', '/client/session', { token })).json() as any
    expect(body.party.isOwner).toBe(false)
    expect(body.canInvite).toBe(false)

    await saveGuildSettings(env.PARTY_KV, 'g3', { ...SETTINGS_DEFAULTS, clientInviters: [MEMBER] })
    body = await (await req('GET', '/client/session', { token })).json() as any
    expect(body.canInvite).toBe(true)
  })

  it('DELETE revokes the token', async () => {
    const token = await linkUser(OWNER, 'Owner', 'g4')
    expect((await req('DELETE', '/client/session', { token })).status).toBe(200)
    expect((await req('GET', '/client/session', { token })).status).toBe(401)
  })
})
