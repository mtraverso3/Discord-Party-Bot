import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  addAdmin, consumeAdminLinkToken, generateAdminToken, isAdmin, listAdmins,
  removeAdmin, writeAdminLinkToken,
} from '../src/store/adminAuth'
import { handleAuth, signSession, SESSION_COOKIE } from '../src/auth/session'
import { handleOidc } from '../src/auth/oidc'
import { sha256B64url } from '../src/lib/jwt'
import type { AppBindings } from '../src/types'

const CLIENT_ID = 'cf-access'
const CLIENT_SECRET = 'sup3r-secret'
const TEAM = 'myteam'
const REDIRECT = `https://${TEAM}.cloudflareaccess.com/cdn-cgi/access/callback`
const BASE = 'https://bot.test'

let oidcEnv: AppBindings

beforeAll(async () => {
  // A throwaway RSA keypair for signing OIDC tokens in-test.
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
  jwk.kid = 'test-key'

  oidcEnv = {
    ...env,
    PUBLIC_BASE_URL: BASE,
    ADMIN_SESSION_SECRET: 'hmac-secret',
    OIDC_CLIENT_ID: CLIENT_ID,
    OIDC_CLIENT_SECRET: CLIENT_SECRET,
    OIDC_PRIVATE_JWK: JSON.stringify(jwk),
    OIDC_EMAIL_DOMAIN: 'discord.local',
    CF_ACCESS_TEAM: TEAM,
  } as AppBindings
})

/** Decode a JWT's payload segment without verifying (tests inspect claims). */
function decodeJwt(jwt: string): any {
  const p = jwt.split('.')[1]!
  const b64 = p.replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)))
}

async function cookieFor(uid: string, name = 'Someone'): Promise<string> {
  return `${SESSION_COOKIE}=${await signSession(uid, name, oidcEnv.ADMIN_SESSION_SECRET!)}`
}

async function authorize(cookie: string | null, extra: Record<string, string> = {}): Promise<Response> {
  const u = new URL(`${BASE}/oidc/authorize`)
  u.searchParams.set('client_id', CLIENT_ID)
  u.searchParams.set('redirect_uri', REDIRECT)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('state', 'xyz')
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v)
  const req = new Request(u, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' })
  return handleOidc(req, oidcEnv, u)
}

async function exchange(body: Record<string, string>): Promise<Response> {
  const u = new URL(`${BASE}/oidc/token`)
  const req = new Request(u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  return handleOidc(req, oidcEnv, u)
}

describe('admin allow-list store', () => {
  it('adds, checks, lists, and removes admins', async () => {
    expect(await isAdmin(env.DB, '111111111111111111')).toBe(false)
    await addAdmin(env.DB, { userId: '111111111111111111', displayName: 'Alice', addedBy: 'root@x' })
    expect(await isAdmin(env.DB, '111111111111111111')).toBe(true)

    const list = await listAdmins(env.DB)
    expect(list.find(a => a.userId === '111111111111111111')?.displayName).toBe('Alice')

    expect(await removeAdmin(env.DB, '111111111111111111')).toBe(true)
    expect(await isAdmin(env.DB, '111111111111111111')).toBe(false)
    expect(await removeAdmin(env.DB, '111111111111111111')).toBe(false)
  })

  it('magic-link tokens are single-use', async () => {
    const token = generateAdminToken()
    await writeAdminLinkToken(env.DB, token, { userId: '222', displayName: 'Bob' })
    expect((await consumeAdminLinkToken(env.DB, token))?.userId).toBe('222')
    expect(await consumeAdminLinkToken(env.DB, token)).toBeNull()
  })
})

describe('/auth/login', () => {
  it('consumes a valid token and sets the session cookie', async () => {
    await addAdmin(env.DB, { userId: '333333333333333333', displayName: 'Carol', addedBy: null })
    const token = generateAdminToken()
    await writeAdminLinkToken(oidcEnv.DB, token, { userId: '333333333333333333', displayName: 'Carol' })

    const u = new URL(`${BASE}/auth/login?token=${token}`)
    const res = await handleAuth(new Request(u, { redirect: 'manual' }), oidcEnv, u)

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/admin')
    expect(res.headers.get('Set-Cookie')).toContain(`${SESSION_COOKIE}=`)
  })

  it('rejects an unknown/used token', async () => {
    const u = new URL(`${BASE}/auth/login?token=deadbeef`)
    const res = await handleAuth(new Request(u), oidcEnv, u)
    expect(res.status).toBe(410)
  })

  it('refuses a token for a de-listed user', async () => {
    const token = generateAdminToken()
    await writeAdminLinkToken(oidcEnv.DB, token, { userId: '999', displayName: 'Ghost' }) // never added
    const u = new URL(`${BASE}/auth/login?token=${token}`)
    const res = await handleAuth(new Request(u), oidcEnv, u)
    expect(res.status).toBe(403)
  })
})

describe('OIDC provider', () => {
  const UID = '444444444444444444'

  beforeAll(async () => {
    await addAdmin(env.DB, { userId: UID, displayName: 'Dave', addedBy: null })
  })

  it('publishes discovery + jwks', async () => {
    const d = new URL(`${BASE}/.well-known/openid-configuration`)
    const disc = await (await handleOidc(new Request(d), oidcEnv, d)).json<any>()
    expect(disc.issuer).toBe(BASE)
    expect(disc.token_endpoint).toBe(`${BASE}/oidc/token`)

    const j = new URL(`${BASE}/oidc/jwks`)
    const jwks = await (await handleOidc(new Request(j), oidcEnv, j)).json<any>()
    expect(jwks.keys[0].kid).toBe('test-key')
    expect(jwks.keys[0].d).toBeUndefined() // private material must not leak
  })

  it('shows a login page when no session cookie is present', async () => {
    const res = await authorize(null)
    expect(res.status).toBe(401)
    expect(res.headers.get('Content-Type')).toContain('text/html')
  })

  it('completes the code→id_token flow with correct claims', async () => {
    const authRes = await authorize(await cookieFor(UID, 'Dave'))
    expect(authRes.status).toBe(302)
    const loc = new URL(authRes.headers.get('Location')!)
    expect(loc.origin + loc.pathname).toBe(REDIRECT)
    expect(loc.searchParams.get('state')).toBe('xyz')
    const code = loc.searchParams.get('code')!
    expect(code).toBeTruthy()

    const tokRes = await exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    })
    expect(tokRes.status).toBe(200)
    const tok = await tokRes.json<any>()
    const claims = decodeJwt(tok.id_token)
    expect(claims.sub).toBe(UID)
    expect(claims.email).toBe(`${UID}@discord.local`)
    expect(claims.aud).toBe(CLIENT_ID)
    expect(claims.iss).toBe(BASE)
    expect(claims.name).toBe('Dave')

    // userinfo mirrors the claims for the access token.
    const uiUrl = new URL(`${BASE}/oidc/userinfo`)
    const ui = await handleOidc(new Request(uiUrl, { headers: { Authorization: `Bearer ${tok.access_token}` } }), oidcEnv, uiUrl)
    expect((await ui.json<any>()).sub).toBe(UID)
  })

  it('rejects a reused authorization code', async () => {
    const loc = new URL((await authorize(await cookieFor(UID))).headers.get('Location')!)
    const code = loc.searchParams.get('code')!
    const first = await exchange({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
    expect(first.status).toBe(200)
    const second = await exchange({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
    expect(second.status).toBe(400)
  })

  it('rejects a bad client secret', async () => {
    const loc = new URL((await authorize(await cookieFor(UID))).headers.get('Location')!)
    const code = loc.searchParams.get('code')!
    const res = await exchange({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT_ID, client_secret: 'wrong' })
    expect(res.status).toBe(401)
  })

  it('enforces PKCE when a challenge was supplied', async () => {
    const verifier = 'a'.repeat(64)
    const challenge = await sha256B64url(verifier)
    const loc = new URL((await authorize(await cookieFor(UID), { code_challenge: challenge, code_challenge_method: 'S256' })).headers.get('Location')!)
    const code = loc.searchParams.get('code')!

    const bad = await exchange({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
    expect(bad.status).toBe(400) // missing verifier

    // The code was consumed by the failed attempt; mint a fresh one.
    const loc2 = new URL((await authorize(await cookieFor(UID), { code_challenge: challenge, code_challenge_method: 'S256' })).headers.get('Location')!)
    const code2 = loc2.searchParams.get('code')!
    const good = await exchange({ grant_type: 'authorization_code', code: code2, redirect_uri: REDIRECT, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code_verifier: verifier })
    expect(good.status).toBe(200)
  })

  it('rejects an unregistered redirect_uri', async () => {
    const u = new URL(`${BASE}/oidc/authorize`)
    u.searchParams.set('client_id', CLIENT_ID)
    u.searchParams.set('redirect_uri', 'https://evil.example/callback')
    u.searchParams.set('response_type', 'code')
    const res = await handleOidc(new Request(u, { headers: { Cookie: await cookieFor(UID) } }), oidcEnv, u)
    expect(res.status).toBe(400)
  })

  it('denies a de-listed user holding a still-valid cookie', async () => {
    const cookie = await cookieFor('555555555555555555', 'Removed') // valid signature, not on the list
    const res = await authorize(cookie)
    expect(res.status).toBe(403)
  })
})
