/**
 * Cloudflare Access JWT verification.
 *
 * Cloudflare Access fronts /admin/* and only forwards authenticated requests,
 * but we still verify the JWT in the Worker as defense in depth — a Worker is
 * reachable from anywhere if its URL leaks, so trusting "the request reached
 * us, therefore it's authorized" is wrong.
 *
 * JWKS are cached per team in module scope and refetched when a token names
 * a key we haven't seen.
 */

interface JsonWebKey {
  kid: string
  kty: string
  alg?: string
  n: string
  e: string
}

const jwksCache = new Map<string, { keys: JsonWebKey[]; fetchedAt: number }>()
const JWKS_TTL_MS = 60 * 60 * 1000
// Floor between refetches for an unknown key ID, so forged IDs can't hammer Access.
const JWKS_REFRESH_MIN_MS = 30 * 1000

export interface VerifyResult {
  ok: boolean
  email?: string
}

async function getJwks(team: string, refresh = false): Promise<JsonWebKey[]> {
  const cached = jwksCache.get(team)
  if (cached && Date.now() - cached.fetchedAt < (refresh ? JWKS_REFRESH_MIN_MS : JWKS_TTL_MS)) return cached.keys
  const res = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`)
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`)
  const data = await res.json<{ keys: JsonWebKey[] }>()
  jwksCache.set(team, { keys: data.keys, fetchedAt: Date.now() })
  return data.keys
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4
  const b64 = (s + '='.repeat(pad)).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}

export async function verifyAccessJwt(jwt: string, team: string, aud: string): Promise<VerifyResult> {
  try {
    const [hStr, pStr, sStr] = jwt.split('.')
    if (!hStr || !pStr || !sStr) return { ok: false }
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(hStr)))
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(pStr)))
    const sig = b64urlToBytes(sStr)

    const audOk = Array.isArray(payload.aud) ? payload.aud.includes(aud) : payload.aud === aud
    if (!audOk) return { ok: false }
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return { ok: false }
    if (payload.nbf && payload.nbf * 1000 > Date.now() + 60_000) return { ok: false }
    if (payload.iss !== `https://${team}.cloudflareaccess.com`) return { ok: false }

    // An unknown key ID usually means Access rotated its keys since the last fetch.
    const jwk = (await getJwks(team)).find(k => k.kid === header.kid)
      ?? (await getJwks(team, true)).find(k => k.kid === header.kid)
    if (!jwk) return { ok: false }

    const key = await crypto.subtle.importKey(
      'jwk',
      jwk as any,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const signed = new TextEncoder().encode(`${hStr}.${pStr}`)
    const verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, signed)
    if (!verified) return { ok: false }

    return { ok: true, email: payload.email }
  } catch {
    return { ok: false }
  }
}
