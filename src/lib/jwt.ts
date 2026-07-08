/**
 * Minimal JWT / crypto primitives for the Discord-identity admin login:
 *
 *   - HMAC-signed session cookies (symmetric — only the Worker verifies them).
 *   - RS256-signed OIDC id/access tokens (asymmetric — Cloudflare Access
 *     verifies them against the public key we publish at /oidc/jwks).
 *
 * Everything runs on the WebCrypto API available in Workers; no dependencies.
 */

// ── base64url ─────────────────────────────────────────────────────────────────

export function bytesToB64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64urlToBytes(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4
  const b64 = (s + '='.repeat(pad)).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}

const enc = (s: string) => bytesToB64url(new TextEncoder().encode(s))
const dec = (s: string) => new TextDecoder().decode(b64urlToBytes(s))

// ── HMAC-SHA256 signed tokens (session cookies) ─────────────────────────────────

async function hmacKey(secret: string, usages: ('sign' | 'verify')[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages,
  )
}

/** Sign a JSON payload into a compact `<payload>.<sig>` token. */
export async function signHmac(payload: Record<string, unknown>, secret: string): Promise<string> {
  const body = enc(JSON.stringify(payload))
  const key = await hmacKey(secret, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return `${body}.${bytesToB64url(new Uint8Array(sig))}`
}

/**
 * Verify an HMAC token and return its payload, or null if the signature is
 * bad, the token is malformed, or the `exp` (ms epoch) has passed.
 */
export async function verifyHmac<T = Record<string, unknown>>(token: string, secret: string): Promise<T | null> {
  const dot = token.lastIndexOf('.')
  if (dot < 1) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  try {
    const key = await hmacKey(secret, ['verify'])
    const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sig), new TextEncoder().encode(body))
    if (!ok) return null
    const payload = JSON.parse(dec(body))
    if (typeof payload.exp === 'number' && payload.exp < Date.now()) return null
    return payload as T
  } catch {
    return null
  }
}

// ── RS256 signed JWTs (OIDC tokens) ─────────────────────────────────────────────

export interface RsaPrivateJwk {
  kty: 'RSA'
  n: string
  e: string
  d: string
  kid?: string
  [k: string]: unknown
}

const RSA_ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const

/** Sign a JWT with RS256. `kid` goes in the header so verifiers can pick the key. */
export async function signRs256(
  jwk: RsaPrivateJwk, claims: Record<string, unknown>, kid: string,
): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', jwk as JsonWebKey, RSA_ALG, false, ['sign'])
  const signingInput = `${enc(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }))}.${enc(JSON.stringify(claims))}`
  const sig = await crypto.subtle.sign(RSA_ALG.name, key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`
}

/** Verify an RS256 JWT against our own public key and return its claims, or null. */
export async function verifyRs256<T = Record<string, unknown>>(jwt: string, jwk: RsaPrivateJwk): Promise<T | null> {
  const parts = jwt.split('.')
  if (parts.length !== 3) return null
  const [h, p, s] = parts as [string, string, string]
  try {
    const pub = publicJwk(jwk)
    const key = await crypto.subtle.importKey('jwk', pub as unknown as JsonWebKey, RSA_ALG, false, ['verify'])
    const ok = await crypto.subtle.verify(RSA_ALG.name, key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`))
    if (!ok) return null
    const claims = JSON.parse(dec(p))
    if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return null
    return claims as T
  } catch {
    return null
  }
}

/** Derive the public JWK (safe to publish) from a private RSA JWK. */
export function publicJwk(jwk: RsaPrivateJwk): Record<string, unknown> {
  return { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', use: 'sig', kid: jwk.kid }
}

/** SHA-256(input) as base64url — used for PKCE S256 verification. */
export async function sha256B64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return bytesToB64url(new Uint8Array(digest))
}
