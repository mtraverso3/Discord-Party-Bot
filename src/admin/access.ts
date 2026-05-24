/**
 * Cloudflare Access JWT verification.
 *
 * Cloudflare Access fronts /admin/* and only forwards authenticated requests,
 * but we still verify the JWT in the Worker as defense in depth — a Worker is
 * reachable from anywhere if its URL leaks, so trusting "the request reached
 * us, therefore it's authorized" is wrong.
 *
 * JWKS are cached in module scope; each fresh isolate fetches once.
 */

interface JsonWebKey {
  kid: string
  kty: string
  alg?: string
  n: string
  e: string
}

let jwksCache: { keys: JsonWebKey[]; expiresAt: number } | null = null
const JWKS_TTL_MS = 60 * 60 * 1000

export interface VerifyResult {
  ok: boolean
  email?: string
}

async function getJwks(team: string): Promise<JsonWebKey[]> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) return jwksCache.keys
  const res = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`)
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`)
  const data = await res.json<{ keys: JsonWebKey[] }>()
  jwksCache = { keys: data.keys, expiresAt: Date.now() + JWKS_TTL_MS }
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
    if (payload.exp && payload.exp * 1000 < Date.now()) return { ok: false }
    if (payload.iss !== `https://${team}.cloudflareaccess.com`) return { ok: false }

    const keys = await getJwks(team)
    const jwk = keys.find(k => k.kid === header.kid)
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
