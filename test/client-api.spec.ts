import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { generateLinkCode, handleClientApi, writeLinkCode } from '../src/client-api'
import { closeParty, createParty, joinParty } from '../src/store/parties'
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

describe('client party approve', () => {
  const QUEUED = '100000000000000003'

  // A closed party queues joiners instead of seating them.
  async function closedPartyWithQueue(guildId: string, partyId: string) {
    await makeParty(guildId, partyId, OWNER, [])
    await closeParty(env.DB, guildId, partyId, OWNER)
    await joinParty(env.DB, guildId, partyId, { userId: QUEUED, username: 'q_un', displayName: 'Queued' })
  }

  it('exposes the closed state and queue on the session', async () => {
    await closedPartyWithQueue('g20', 'LCU020')
    const token = await linkUser(OWNER, 'Owner', 'g20')

    const body = await (await req('GET', '/client/session', { token })).json() as any
    expect(body.party.isClosed).toBe(true)
    expect(body.party.queue).toHaveLength(1)
    expect(body.party.queue[0].userId).toBe(QUEUED)
    expect(body.party.members.some((m: any) => m.userId === QUEUED)).toBe(false)
  })

  it('requires a valid bearer token', async () => {
    expect((await req('POST', '/client/party/approve', { body: { userId: QUEUED } })).status).toBe(401)
  })

  it('lets the owner approve a queued player into an open slot', async () => {
    await closedPartyWithQueue('g21', 'LCU021')
    const token = await linkUser(OWNER, 'Owner', 'g21')

    const res = await req('POST', '/client/party/approve', { body: { userId: QUEUED }, token })
    expect(res.status).toBe(200)
    expect((await res.json() as any).ok).toBe(true)

    const body = await (await req('GET', '/client/session', { token })).json() as any
    expect(body.party.members.some((m: any) => m.userId === QUEUED)).toBe(true)
    expect(body.party.queue).toHaveLength(0)
  })

  it('rejects non-owners', async () => {
    await closedPartyWithQueue('g22', 'LCU022')
    await joinParty(env.DB, 'g22', 'LCU022', { userId: MEMBER, username: 'm_un', displayName: 'Member' })
    const token = await linkUser(MEMBER, 'Member', 'g22')

    const res = await req('POST', '/client/party/approve', { body: { userId: QUEUED }, token })
    expect(res.status).toBe(403)
  })

  it('rejects a user who is not in the queue', async () => {
    await closedPartyWithQueue('g23', 'LCU023')
    const token = await linkUser(OWNER, 'Owner', 'g23')

    const res = await req('POST', '/client/party/approve', { body: { userId: MEMBER }, token })
    expect(res.status).toBe(400)
    expect((await res.json() as any).error).toMatch(/no longer in the queue/)
  })

  it('rejects an approve into a full party', async () => {
    await makeParty('g24', 'LCU024', OWNER, [])
    // Fill every remaining slot (maxSize 5, owner already seated).
    for (let i = 0; i < 4; i++) {
      await joinParty(env.DB, 'g24', 'LCU024', { userId: `20000000000000000${i}`, username: `f${i}`, displayName: `Filler ${i}` })
    }
    await closeParty(env.DB, 'g24', 'LCU024', OWNER)
    await joinParty(env.DB, 'g24', 'LCU024', { userId: QUEUED, username: 'q_un', displayName: 'Queued' })
    const token = await linkUser(OWNER, 'Owner', 'g24')

    const res = await req('POST', '/client/party/approve', { body: { userId: QUEUED }, token })
    expect(res.status).toBe(400)
    expect((await res.json() as any).error).toMatch(/full/)
  })

  it('400s on a missing userId, 404s when not in a party', async () => {
    await closedPartyWithQueue('g25', 'LCU025')
    const token = await linkUser(OWNER, 'Owner', 'g25')
    expect((await req('POST', '/client/party/approve', { body: {}, token })).status).toBe(400)

    const loner = await linkUser(MEMBER, 'Member', 'g26')
    expect((await req('POST', '/client/party/approve', { body: { userId: QUEUED }, token: loner })).status).toBe(404)
  })
})

describe('client party deny', () => {
  const QUEUED = '100000000000000004'

  async function closedPartyWithQueue(guildId: string, partyId: string) {
    await makeParty(guildId, partyId, OWNER, [])
    await closeParty(env.DB, guildId, partyId, OWNER)
    await joinParty(env.DB, guildId, partyId, { userId: QUEUED, username: 'q_un', displayName: 'Queued' })
  }

  it('requires a valid bearer token', async () => {
    expect((await req('POST', '/client/party/deny', { body: { userId: QUEUED } })).status).toBe(401)
  })

  it('lets the owner drop a queued player without seating them', async () => {
    await closedPartyWithQueue('g30', 'LCU030')
    const token = await linkUser(OWNER, 'Owner', 'g30')

    const res = await req('POST', '/client/party/deny', { body: { userId: QUEUED }, token })
    expect(res.status).toBe(200)
    expect((await res.json() as any).ok).toBe(true)

    const body = await (await req('GET', '/client/session', { token })).json() as any
    expect(body.party.queue).toHaveLength(0)
    expect(body.party.members.some((m: any) => m.userId === QUEUED)).toBe(false)
  })

  it('rejects non-owners', async () => {
    await closedPartyWithQueue('g31', 'LCU031')
    await joinParty(env.DB, 'g31', 'LCU031', { userId: MEMBER, username: 'm_un', displayName: 'Member' })
    const token = await linkUser(MEMBER, 'Member', 'g31')

    const res = await req('POST', '/client/party/deny', { body: { userId: QUEUED }, token })
    expect(res.status).toBe(403)
  })

  it('rejects a user who is not in the queue', async () => {
    await closedPartyWithQueue('g32', 'LCU032')
    const token = await linkUser(OWNER, 'Owner', 'g32')

    const res = await req('POST', '/client/party/deny', { body: { userId: MEMBER }, token })
    expect(res.status).toBe(400)
    expect((await res.json() as any).error).toMatch(/no longer in the queue/)
  })

  it('works on a full party — a denied player never needed a slot', async () => {
    await makeParty('g33', 'LCU033', OWNER, [])
    for (let i = 0; i < 4; i++) {
      await joinParty(env.DB, 'g33', 'LCU033', { userId: `30000000000000000${i}`, username: `f${i}`, displayName: `Filler ${i}` })
    }
    await closeParty(env.DB, 'g33', 'LCU033', OWNER)
    await joinParty(env.DB, 'g33', 'LCU033', { userId: QUEUED, username: 'q_un', displayName: 'Queued' })
    const token = await linkUser(OWNER, 'Owner', 'g33')

    expect((await req('POST', '/client/party/deny', { body: { userId: QUEUED }, token })).status).toBe(200)
  })

  it('400s on a missing userId, 404s when not in a party', async () => {
    await closedPartyWithQueue('g34', 'LCU034')
    const token = await linkUser(OWNER, 'Owner', 'g34')
    expect((await req('POST', '/client/party/deny', { body: {}, token })).status).toBe(400)

    const loner = await linkUser(MEMBER, 'Member', 'g35')
    expect((await req('POST', '/client/party/deny', { body: { userId: QUEUED }, token: loner })).status).toBe(404)
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
