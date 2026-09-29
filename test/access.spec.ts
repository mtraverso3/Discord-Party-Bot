import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyAccessJwt } from '../src/admin/access'
import { signRs256, type RsaPrivateJwk } from '../src/lib/jwt'

const AUD = 'aud-tag'
let seq = 0
const newTeam = () => `team${++seq}`

async function makeKey(kid: string): Promise<RsaPrivateJwk> {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  ) as CryptoKeyPair
  return { ...(await crypto.subtle.exportKey('jwk', kp.privateKey)), kid } as RsaPrivateJwk
}

let keyA: RsaPrivateJwk
let keyB: RsaPrivateJwk
beforeAll(async () => { [keyA, keyB] = await Promise.all([makeKey('a'), makeKey('b')]) })

let published: RsaPrivateJwk[]
let certFetches: number
const original = globalThis.fetch
beforeEach(() => {
  published = []
  certFetches = 0
  globalThis.fetch = vi.fn(async () => {
    certFetches++
    return Response.json({ keys: published.map(k => ({ kid: k.kid, kty: 'RSA', n: k.n, e: k.e })) })
  }) as any
})
afterEach(() => {
  globalThis.fetch = original
  vi.restoreAllMocks()
})

const now = () => Math.floor(Date.now() / 1000)
const token = (key: RsaPrivateJwk, team: string, claims: Record<string, unknown> = {}) =>
  signRs256(key, { aud: [AUD], iss: `https://${team}.cloudflareaccess.com`, exp: now() + 60, email: 'a@b.c', ...claims }, key.kid!)

describe('verifyAccessJwt', () => {
  it('accepts a valid token and returns the email', async () => {
    const team = newTeam()
    published = [keyA]
    expect(await verifyAccessJwt(await token(keyA, team), team, AUD)).toEqual({ ok: true, email: 'a@b.c' })
  })

  it('rejects a wrong audience, issuer, expiry, a missing expiry, or a bad signature', async () => {
    const team = newTeam()
    published = [keyA]
    expect((await verifyAccessJwt(await token(keyA, team, { aud: ['other'] }), team, AUD)).ok).toBe(false)
    expect((await verifyAccessJwt(await token(keyA, team, { iss: 'https://evil.cloudflareaccess.com' }), team, AUD)).ok).toBe(false)
    expect((await verifyAccessJwt(await token(keyA, team, { exp: now() - 10 }), team, AUD)).ok).toBe(false)
    expect((await verifyAccessJwt(await token(keyA, team, { exp: undefined }), team, AUD)).ok).toBe(false)
    const forged = await token({ ...keyB, kid: 'a' }, team)
    expect((await verifyAccessJwt(forged, team, AUD)).ok).toBe(false)
  })

  it('picks up a rotated key without waiting for the cache to expire', async () => {
    const team = newTeam()
    published = [keyA]
    expect((await verifyAccessJwt(await token(keyA, team), team, AUD)).ok).toBe(true)

    published = [keyA, keyB]
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000)
    expect((await verifyAccessJwt(await token(keyB, team), team, AUD)).ok).toBe(true)
  })

  it('refetches for unknown keys at most every 30 seconds', async () => {
    const team = newTeam()
    published = [keyA]
    await verifyAccessJwt(await token(keyA, team), team, AUD)
    const unknown = await token({ ...keyB, kid: 'nope' }, team)
    for (let i = 0; i < 5; i++) expect((await verifyAccessJwt(unknown, team, AUD)).ok).toBe(false)
    expect(certFetches).toBe(1)
  })
})
