import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { generateLinkCode, handleClientApi, writeLinkCode } from '../src/client-api'
import { hashToken } from '../src/store/clientAuth'
import { exhaust } from './limits'
import { closeParty, createParty, joinParty } from '../src/store/parties'
import { saveUserIgn } from '../src/store/profiles'
import { MAX_GAMES_PER_SESSION } from '../src/store/games'
import { saveGuildSettings, SETTINGS_DEFAULTS } from '../src/store/settings'

const OWNER = '100000000000000001'
const MEMBER = '100000000000000002'

let ipSeq = 0

function req(method: string, path: string, opts: { body?: unknown; token?: string; ip?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'cf-connecting-ip': opts.ip ?? `10.0.0.${++ipSeq}`,
  }
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

  it("rejects games outside the guild's game list", async () => {
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
    await saveGuildSettings(env.DB, 'g8', { ...SETTINGS_DEFAULTS, disabledGames: ['LoL NA'] })
    const token = await linkUser(OWNER, 'Owner', 'g8')
    const res = await req('POST', '/client/party/game', { body: { game: 'LoL NA' }, token })
    expect(res.status).toBe(400)
  })

  it("accepts the guild's custom games", async () => {
    await makeParty('g12', 'LCU016', OWNER, [])
    await saveGuildSettings(env.DB, 'g12', { ...SETTINGS_DEFAULTS, customGames: ['Deadlock'] })
    const token = await linkUser(OWNER, 'Owner', 'g12')
    const res = await req('POST', '/client/party/game', { body: { game: 'Deadlock' }, token })
    expect(res.status).toBe(200)
    expect((await res.json() as any).game).toBe('Deadlock')
  })

  it('404s when not in a party', async () => {
    const token = await linkUser(OWNER, 'Owner', 'g9')
    const res = await req('POST', '/client/party/game', { body: { game: 'LoL NA' }, token })
    expect(res.status).toBe(404)
  })
})

describe('client lookup', () => {
  it('reports a Riot ID that belongs to a current member as inParty', async () => {
    // The member's party IGN snapshot says one thing; their registered profile
    // says another. The client only asks about Riot IDs its own matching
    // already failed on, so this is the answer that stops a renamed member
    // being flagged "not in party".
    await makeParty('g-lookup', 'LCU100', OWNER, [MEMBER])
    await saveUserIgn(env.DB, MEMBER, 'League of Legends', 'RenamedAccount#NA1')
    const token = await linkUser(OWNER, 'Owner', 'g-lookup')

    const res = await req('POST', '/client/lookup', {
      body: { riotIds: ['RenamedAccount#NA1'] }, token,
    })
    expect(res.status).toBe(200)
    const { players } = await res.json() as any
    expect(players['RenamedAccount#NA1']).toEqual({
      userId: MEMBER,
      displayName: `User ${MEMBER}`,
      inParty: true,
    })
  })

  it('returns null for a Riot ID nobody has registered', async () => {
    await makeParty('g-lookup2', 'LCU101', OWNER, [])
    const token = await linkUser(OWNER, 'Owner', 'g-lookup2')

    const res = await req('POST', '/client/lookup', { body: { riotIds: ['Nobody#NA1'] }, token })
    expect(res.status).toBe(200)
    const { players } = await res.json() as any
    expect(players['Nobody#NA1']).toBeNull()
  })

  it('matches a tagline-less registration against any tagline', async () => {
    await makeParty('g-lookup3', 'LCU102', OWNER, [MEMBER])
    await saveUserIgn(env.DB, MEMBER, 'League of Legends', 'NoTagPlayer')
    const token = await linkUser(OWNER, 'Owner', 'g-lookup3')

    const res = await req('POST', '/client/lookup', { body: { riotIds: ['NoTagPlayer#EUW'] }, token })
    const { players } = await res.json() as any
    expect(players['NoTagPlayer#EUW']).toMatchObject({ userId: MEMBER, inParty: true })
  })

  it('404s when the caller is not in a party', async () => {
    const token = await linkUser(OWNER, 'Owner', 'g-lookup4')
    const res = await req('POST', '/client/lookup', { body: { riotIds: ['Anyone#NA1'] }, token })
    expect(res.status).toBe(404)
  })
})

describe('client game reports', () => {
  const report = (token: string, gameId: string) =>
    req('POST', '/client/party/game-report', { token, body: { region: 'NA', gameId } })

  it('records a game for a party member', async () => {
    await makeParty('g-rep1', 'REP001', OWNER)
    const token = await linkUser(OWNER, 'Owner', 'g-rep1')
    const res = await report(token, '123')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, matchId: 'NA1_123' })
  })

  it('ignores reports from someone only in the queue', async () => {
    await makeParty('g-rep2', 'REP002', OWNER)
    await closeParty(env.DB, 'g-rep2', 'REP002', OWNER)
    await joinParty(env.DB, 'g-rep2', 'REP002', { userId: MEMBER, username: 'm', displayName: 'M' })
    const token = await linkUser(MEMBER, 'M', 'g-rep2')
    expect((await report(token, '1')).status).toBe(404)
  })

  it(`caps a session at ${MAX_GAMES_PER_SESSION} reports, but re-reporting a known game is fine`, async () => {
    await makeParty('g-rep3', 'REP003', OWNER)
    const token = await linkUser(OWNER, 'Owner', 'g-rep3')
    for (let i = 0; i < MAX_GAMES_PER_SESSION; i++) expect((await report(token, `${i}`)).status).toBe(200)
    expect((await report(token, '999999')).status).toBe(400)
    expect((await report(token, '0')).status).toBe(200)
  })
})

describe('client rate limits', () => {
  it('limits link-code guesses per IP', async () => {
    const guess = () => req('POST', '/client/auth', { body: { code: 'AAAAAAAA' }, ip: '203.0.113.7' })
    const { before, limited } = await exhaust(10, guess)
    expect(new Set(before)).toEqual(new Set([404]))
    expect(limited?.headers.get('retry-after')).toBe('60')
    expect((await req('POST', '/client/auth', { body: { code: 'AAAAAAAA' }, ip: '203.0.113.8' })).status).toBe(404)
  })

  it('limits live-game lookups per user', async () => {
    const token = await linkUser(MEMBER, 'M', 'g-riot')
    const live = () => req('POST', '/client/champions/live', { token, body: { region: 'NA', gameName: 'a', tagLine: 'b' } })
    const { before, limited } = await exhaust(30, live)
    expect(new Set(before)).toEqual(new Set([200]))
    expect(limited?.status).toBe(429)
  })

  it('limits every call per token', async () => {
    const token = 'e'.repeat(64)
    const { before, limited } = await exhaust(300, () => req('GET', '/client/session', { token }))
    expect(new Set(before)).toEqual(new Set([401]))
    expect(limited?.status).toBe(429)
  })
})

describe('client token storage', () => {
  it('stores tokens hashed, never raw', async () => {
    const token = await linkUser('100000000000000077', 'Hashed', 'g-hash')
    const { results } = await env.DB.prepare('SELECT token FROM client_tokens WHERE user_id = ?1')
      .bind('100000000000000077').all<{ token: string }>()
    expect(results.map(r => r.token)).toEqual([await hashToken(token)])
  })

  it('still accepts a token stored raw before hashing, and upgrades it', async () => {
    const raw = 'c'.repeat(64)
    const now = Date.now()
    await env.DB.prepare(`
      INSERT INTO client_tokens (token, user_id, guild_id, display_name, created_at, refreshed_at, expires_at)
      VALUES (?1, 'legacy', 'g-legacy', 'Legacy', ?2, ?2, ?3)
    `).bind(raw, now, now + 60_000).run()

    expect((await req('GET', '/client/session', { token: raw })).status).toBe(200)
    const row = await env.DB.prepare("SELECT token FROM client_tokens WHERE user_id = 'legacy'").first<{ token: string }>()
    expect(row!.token).toBe(await hashToken(raw))
    expect((await req('GET', '/client/session', { token: raw })).status).toBe(200)

    expect((await req('DELETE', '/client/session', { token: raw })).status).toBe(200)
    expect((await req('GET', '/client/session', { token: raw })).status).toBe(401)
  })
})
