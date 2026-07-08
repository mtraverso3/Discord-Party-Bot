import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { generateLinkCode, handleClientApi, writeLinkCode } from '../src/client-api'
import { createParty, joinParty } from '../src/store/parties'
import { saveUserIgn } from '../src/store/profiles'
import { saveGuildSettings, SETTINGS_DEFAULTS } from '../src/store/settings'

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
  await writeLinkCode(env.DB, code, { guildId, discordUserId: userId, displayName })
  const res = await req('POST', '/client/auth', { body: { code } })
  expect(res.status).toBe(200)
  const body = await res.json() as any
  expect(body.token).toMatch(/^[0-9a-f]{64}$/)
  return body.token
}

async function makeParty(guildId: string, partyId: string, ownerId: string, extraMembers: string[] = []) {
  const created = await createParty(env.DB, {
    id: partyId, guildId, name: 'Inhouse', description: '', game: 'League of Legends',
    owner: { userId: ownerId, username: 'owner_un', displayName: 'Owner' }, maxSize: 5,
  })
  if (!created.ok) throw new Error(created.message)
  for (const m of extraMembers) {
    await joinParty(env.DB, guildId, partyId, { userId: m, username: `${m}_un`, displayName: `User ${m}` })
  }
}

describe('client auth', () => {
  it('exchanges a link code for a long-lived token, single use', async () => {
    const code = generateLinkCode()
    await writeLinkCode(env.DB, code, { guildId: 'g1', discordUserId: OWNER, displayName: 'Owner' })

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
    await saveUserIgn(env.DB, MEMBER, 'League of Legends', 'Sniper#NA1')
    await makeParty('g2', 'LCU001', OWNER, [MEMBER])
    const token = await linkUser(OWNER, 'Owner', 'g2')

    const res = await req('GET', '/client/session', { token })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.party.id).toBe('LCU001')
    expect(body.party.isOwner).toBe(true)
    expect(body.canInvite).toBe(true)
    const member = body.party.members.find((m: any) => m.userId === MEMBER)
    expect(member).toBeTruthy()

    // Non-owner member: no invite rights until allowlisted.
    const memberToken = await linkUser(MEMBER, 'Member', 'g2')
    let mBody = await (await req('GET', '/client/session', { token: memberToken })).json() as any
    expect(mBody.party.isOwner).toBe(false)
    expect(mBody.canInvite).toBe(false)

    await saveGuildSettings(env.DB, 'g2', { ...SETTINGS_DEFAULTS, clientInviters: [MEMBER] })
    mBody = await (await req('GET', '/client/session', { token: memberToken })).json() as any
    expect(mBody.canInvite).toBe(true)
  })

  it('DELETE revokes the token', async () => {
    const token = await linkUser(OWNER, 'Owner', 'g4')
    expect((await req('DELETE', '/client/session', { token })).status).toBe(200)
    expect((await req('GET', '/client/session', { token })).status).toBe(401)
  })
})

describe('client party game switch', () => {
  it('requires a valid bearer token', async () => {
    const res = await req('POST', '/client/party/game', { body: { game: 'LoL NA' } })
    expect(res.status).toBe(401)
  })

  it('lets the owner switch the game and refreshes members\' per-game IGNs', async () => {
    await makeParty('g5', 'LCU010', OWNER, [MEMBER])
    await saveUserIgn(env.DB, MEMBER, 'LoL NA', 'Sniper#NA1')
    const token = await linkUser(OWNER, 'Owner', 'g5')

    const res = await req('POST', '/client/party/game', { body: { game: 'LoL NA' }, token })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.ok).toBe(true)
    expect(body.game).toBe('LoL NA')

    const session = await (await req('GET', '/client/session', { token })).json() as any
    expect(session.party.game).toBe('LoL NA')
    const member = session.party.members.find((m: any) => m.userId === MEMBER)
    expect(member.ign).toBe('Sniper#NA1')
  })

  it('is a no-op when the game is already set', async () => {
    await makeParty('g6', 'LCU011', OWNER, [])
    const token = await linkUser(OWNER, 'Owner', 'g6')
    await req('POST', '/client/party/game', { body: { game: 'LoL NA' }, token })
    const res = await req('POST', '/client/party/game', { body: { game: 'LoL NA' }, token })
    expect(res.status).toBe(200)
    expect((await res.json() as any).ok).toBe(true)
  })

  it('rejects games outside the GAMES catalog', async () => {
    await makeParty('g11', 'LCU015', OWNER, [])
    const token = await linkUser(OWNER, 'Owner', 'g11')
    const res = await req('POST', '/client/party/game', { body: { game: 'Not A Real Game' }, token })
    expect(res.status).toBe(400)
  })

  it('rejects non-owners', async () => {
    await makeParty('g7', 'LCU012', OWNER, [MEMBER])
    const token = await linkUser(MEMBER, 'Member', 'g7')
    const res = await req('POST', '/client/party/game', { body: { game: 'LoL NA' }, token })
    expect(res.status).toBe(403)
  })

  it('rejects games disabled by guild settings', async () => {
    await makeParty('g8', 'LCU013', OWNER, [])
    await saveGuildSettings(env.DB, 'g8', { ...SETTINGS_DEFAULTS, allowedGames: ['Valorant'] })
    const token = await linkUser(OWNER, 'Owner', 'g8')
    const res = await req('POST', '/client/party/game', { body: { game: 'LoL NA' }, token })
    expect(res.status).toBe(400)
  })

  it('404s when not in a party', async () => {
    const token = await linkUser(OWNER, 'Owner', 'g9')
    const res = await req('POST', '/client/party/game', { body: { game: 'LoL NA' }, token })
    expect(res.status).toBe(404)
  })
})
