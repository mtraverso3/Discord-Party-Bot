import type { AppBindings, PartyData } from '../types'
import { callParty, getPartyStub, getUserPartyId } from '../lib/party'
import { getGuildSettings } from '../lib/settings'

// HTTP API consumed by the PartyBot desktop client.
//
//   POST   /client/auth     { code }  -> { token, userId, guildId, displayName }
//   GET    /client/session  (Bearer)  -> { userId, displayName, guildId, canInvite, party | null }
//   DELETE /client/session  (Bearer)  -> { ok }
//
// A short-lived link code (from `/party link` in Discord) is exchanged once
// for a long-lived bearer token tied to the Discord user, so the client stays
// linked across parties and restarts.

export interface LinkRecord {
  guildId: string
  discordUserId: string
  displayName: string
}

interface TokenRecord {
  userId: string
  guildId: string
  displayName: string
  createdAt: number
  refreshedAt: number
}

const LINK_TTL_SECONDS = 10 * 60                  // link codes: 10 minutes
const TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60       // tokens: 90 days, sliding
const TOKEN_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000  // re-extend at most daily
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

function generateToken(): string {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('')
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function handleClientApi(req: Request, env: AppBindings, url: URL): Promise<Response> {
  if (url.pathname === '/client/auth' && req.method === 'POST') {
    return await auth(req, env)
  }
  if (url.pathname === '/client/session') {
    if (req.method !== 'GET' && req.method !== 'DELETE') {
      return new Response('Method Not Allowed', { status: 405 })
    }
    return await session(req, env)
  }
  return new Response('Not Found', { status: 404 })
}

async function auth(req: Request, env: AppBindings): Promise<Response> {
  let body: { code?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400)
  }
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
  if (!/^[A-Z2-9]{8}$/.test(code)) return json({ error: 'Invalid code format.' }, 400)

  const raw = await env.PARTY_KV.get(`lcu:${code}`)
  if (!raw) return json({ error: 'Code not found or expired. Run /party link again.' }, 404)
  const link = JSON.parse(raw) as LinkRecord

  // Codes are single-use.
  await env.PARTY_KV.delete(`lcu:${code}`)

  const token = generateToken()
  const now = Date.now()
  const rec: TokenRecord = {
    userId: link.discordUserId,
    guildId: link.guildId,
    displayName: link.displayName,
    createdAt: now,
    refreshedAt: now,
  }
  await env.PARTY_KV.put(`client-token:${token}`, JSON.stringify(rec), {
    expirationTtl: TOKEN_TTL_SECONDS,
  })

  return json({
    token,
    userId: link.discordUserId,
    guildId: link.guildId,
    displayName: link.displayName,
  })
}

async function session(req: Request, env: AppBindings): Promise<Response> {
  const header = req.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!/^[0-9a-f]{64}$/.test(token)) return json({ error: 'Not linked.' }, 401)

  const key = `client-token:${token}`
  const raw = await env.PARTY_KV.get(key)
  if (!raw) return json({ error: 'Token expired or revoked. Link again with /party link.' }, 401)
  const rec = JSON.parse(raw) as TokenRecord

  if (req.method === 'DELETE') {
    await env.PARTY_KV.delete(key)
    return json({ ok: true })
  }

  // Sliding expiry: extend the token while the client is in active use.
  const now = Date.now()
  if (now - rec.refreshedAt > TOKEN_REFRESH_INTERVAL_MS) {
    rec.refreshedAt = now
    await env.PARTY_KV.put(key, JSON.stringify(rec), { expirationTtl: TOKEN_TTL_SECONDS })
  }

  const partyId = await getUserPartyId(env.PARTY_KV, rec.guildId, rec.userId)
  let party: unknown = null
  let canInvite = false
  if (partyId) {
    const stub = getPartyStub(env, rec.guildId, partyId)
    const data = await callParty<PartyData | null>(stub, 'get').catch(() => null)
    if (data && data.members.some(m => m.userId === rec.userId)) {
      const settings = await getGuildSettings(env.PARTY_KV, rec.guildId)
      const isOwner = data.ownerId === rec.userId
      canInvite = isOwner || settings.clientInviters.includes(rec.userId)
      party = {
        id: data.id,
        name: data.name,
        game: data.game,
        maxSize: data.maxSize,
        isOwner,
        members: data.members.map(m => ({
          userId: m.userId,
          displayName: m.displayName,
          ign: m.ign ?? null,
          isOwner: m.userId === data.ownerId,
        })),
      }
    }
  }

  return json({
    userId: rec.userId,
    displayName: rec.displayName,
    guildId: rec.guildId,
    canInvite,
    party,
  })
}
