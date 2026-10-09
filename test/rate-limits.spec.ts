import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { handleAdminApi } from '../src/admin/api'
import { handleOidc } from '../src/auth/oidc'
import { handleAuth } from '../src/auth/session'

let seq = 0
const ip = () => `198.51.100.${++seq}`

const oidcEnv = {
  ...env,
  PUBLIC_BASE_URL: 'https://party.example.test',
  ADMIN_SESSION_SECRET: 'secret',
  OIDC_CLIENT_ID: 'client',
  OIDC_CLIENT_SECRET: 'client-secret',
  OIDC_PRIVATE_JWK: '{}',
}

async function times(n: number, send: () => Promise<Response>): Promise<number[]> {
  const statuses: number[] = []
  for (let i = 0; i < n; i++) statuses.push((await send()).status)
  return statuses
}

describe('login rate limits', () => {
  it('limits the magic-link landing per IP', async () => {
    const from = ip()
    const login = (addr: string) => {
      const url = new URL('https://party.example.test/auth/login?token=nope')
      return handleAuth(new Request(url, { headers: { 'cf-connecting-ip': addr } }), oidcEnv, url)
    }
    expect(await times(30, () => login(from))).not.toContain(429)
    const limited = await login(from)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
    expect((await login(ip())).status).not.toBe(429)
  })

  it('limits the OIDC token endpoint per IP, but not the public metadata', async () => {
    const from = ip()
    const call = (path: string, method = 'GET') => {
      const url = new URL(`https://party.example.test${path}`)
      return handleOidc(new Request(url, {
        method, headers: { 'cf-connecting-ip': from, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: method === 'POST' ? 'grant_type=nope' : undefined,
      }), oidcEnv, url)
    }
    expect(await times(30, () => call('/oidc/token', 'POST'))).not.toContain(429)
    expect((await call('/oidc/token', 'POST')).status).toBe(429)
    expect(await times(50, () => call('/oidc/jwks'))).not.toContain(429)
    expect(await times(50, () => call('/.well-known/openid-configuration'))).not.toContain(429)
  })
})

describe('admin API rate limits', () => {
  const admin = (who: string, path: string) => {
    const url = new URL(`https://party.example.test/admin/api${path}${path.includes('?') ? '&' : '?'}guild=rl`)
    return handleAdminApi(new Request(url), env, url, who)
  }

  it('limits each admin, not everyone', async () => {
    const who = `busy-${++seq}@example.com`
    expect(await times(600, () => admin(who, '/settings'))).not.toContain(429)
    const limited = await admin(who, '/settings')
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
    expect((await limited.json<any>()).error).toContain('Too many requests')
    expect((await admin(`calm-${++seq}@example.com`, '/settings')).status).toBe(200)
  })

  it('limits the routes that fan out to Discord more tightly', async () => {
    const who = `search-${++seq}@example.com`
    expect(await times(120, () => admin(who, '/members?q=a'))).not.toContain(429)
    expect((await admin(who, '/members?q=a')).status).toBe(429)
    expect((await admin(who, '/settings')).status).toBe(200)
  })
})
