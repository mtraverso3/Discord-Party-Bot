import type { AppBindings, PartyData } from '../types'
import { callParty, getPartyStub } from '../lib/party'

interface LinkRecord {
  partyId: string
  guildId: string
  discordUserId: string
}

interface SummonerRecord {
  summonerId: number
  puuid: string
}

const LINK_TTL_SECONDS = 10 * 60        // 10 minutes
const SUMMONER_TTL_SECONDS = 2 * 60 * 60 // 2 hours
const CODE_LENGTH = 8
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // omit ambiguous chars

export function generateLinkCode(): string {
  const buf = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(buf)
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[buf[i]! % CODE_ALPHABET.length]
  }
  return out
}

export async function writeLinkCode(
  kv: KVNamespace,
  code: string,
  record: LinkRecord,
): Promise<void> {
  await kv.put(`lcu:${code}`, JSON.stringify(record), { expirationTtl: LINK_TTL_SECONDS })
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function handleLcu(req: Request, env: AppBindings, url: URL): Promise<Response> {
  // Routes:
  //   GET    /lcu/link/:code
  //   POST   /lcu/link/:code/register
  //   DELETE /lcu/link/:code/register
  const match = url.pathname.match(/^\/lcu\/link\/([^/]+)(\/register)?$/)
  if (!match) return new Response('Not Found', { status: 404 })

  const code = match[1]!
  const isRegisterRoute = !!match[2]

  const raw = await env.PARTY_KV.get(`lcu:${code}`)
  if (!raw) return json({ error: 'Code not found or expired.' }, 404)
  const link = JSON.parse(raw) as LinkRecord

  const stub = getPartyStub(env, link.guildId, link.partyId)
  const party = await callParty<PartyData | null>(stub, 'get').catch(() => null)
  if (!party) return json({ error: 'Party no longer exists.' }, 404)

  const isMember = party.members.some(m => m.userId === link.discordUserId)
  if (!isMember) return json({ error: 'You are no longer a member of this party.' }, 403)

  if (!isRegisterRoute) {
    if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 })
    return json(await buildPartyResponse(env.PARTY_KV, party, link.discordUserId))
  }

  if (req.method === 'POST') {
    let body: { summonerId?: number; puuid?: string }
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400)
    }
    if (typeof body.summonerId !== 'number' || typeof body.puuid !== 'string') {
      return json({ error: 'Body must include numeric summonerId and string puuid.' }, 400)
    }
    const rec: SummonerRecord = { summonerId: body.summonerId, puuid: body.puuid }
    await env.PARTY_KV.put(
      `lcu-summoner:${party.id}:${link.discordUserId}`,
      JSON.stringify(rec),
      { expirationTtl: SUMMONER_TTL_SECONDS },
    )
    return json({ ok: true })
  }

  if (req.method === 'DELETE') {
    await env.PARTY_KV.delete(`lcu-summoner:${party.id}:${link.discordUserId}`)
    return json({ ok: true })
  }

  return new Response('Method Not Allowed', { status: 405 })
}

async function buildPartyResponse(
  kv: KVNamespace,
  party: PartyData,
  discordUserId: string,
): Promise<unknown> {
  const summonerEntries = await Promise.all(
    party.members.map(async (m) => {
      const raw = await kv.get(`lcu-summoner:${party.id}:${m.userId}`)
      const rec = raw ? (JSON.parse(raw) as SummonerRecord) : null
      return { userId: m.userId, summonerId: rec?.summonerId ?? null }
    }),
  )
  const summonerByUser = new Map(summonerEntries.map(e => [e.userId, e.summonerId]))
  const ownerSummonerId = summonerByUser.get(party.ownerId) ?? null

  return {
    partyId: party.id,
    partyName: party.name,
    game: party.game,
    isOwner: discordUserId === party.ownerId,
    ownerSummonerId,
    members: party.members.map(m => ({
      discordUserId: m.userId,
      displayName: m.displayName,
      summonerId: summonerByUser.get(m.userId) ?? null,
      isOwner: m.userId === party.ownerId,
    })),
  }
}
