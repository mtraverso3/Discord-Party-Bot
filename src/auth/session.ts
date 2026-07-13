// The magic-link landing (/auth/login) and the admin session cookie.
//
// `/party admin` hands an allow-listed Discord user a single-use link to
// /auth/login?token=…. This endpoint sits OUTSIDE the Cloudflare Access app
// (Access only fronts /admin*), so the browser can reach it unauthenticated.
// It consumes the token, re-checks the allow-list, and drops a signed 24h
// session cookie identifying the Discord user. From there, hitting /admin
// bounces through the Worker's OIDC provider (src/auth/oidc.ts), which reads
// this cookie to satisfy Cloudflare Access — no email, no Discord OAuth.

import type { AppBindings } from '../types'
import { signHmac, verifyHmac } from '../lib/jwt'
import { consumeAdminLinkToken, isAdmin, touchAdminLogin } from '../store/adminAuth'

export const SESSION_COOKIE = 'pb_admin_session'
const SESSION_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Normalize a configured base URL: assume https:// when no scheme is given and
 * drop any trailing slash. Keeps the OIDC issuer valid and the `/party admin`
 * link a proper (auto-hyperlinked) URL even if the secret was set without a
 * scheme.
 */
export function normalizeBaseUrl(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '')
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export interface AdminSession {
  uid: string
  name: string
  gid: string   // guild this magic-link session is scoped to
  exp: number
}

/** Mint the signed cookie value for a Discord identity scoped to one guild. */
export async function signSession(uid: string, name: string, gid: string, secret: string): Promise<string> {
  return signHmac({ uid, name, gid, exp: Date.now() + SESSION_TTL_MS }, secret)
}

/** Read + verify the admin session cookie from a request; null if absent/invalid/expired. */
export async function readSession(req: Request, secret: string): Promise<AdminSession | null> {
  const raw = parseCookie(req, SESSION_COOKIE)
  if (!raw) return null
  const s = await verifyHmac<AdminSession>(raw, secret)
  return s && s.uid && s.gid ? s : null
}

function cookieHeader(value: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`
}

export function parseCookie(req: Request, name: string): string | null {
  const header = req.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

export async function handleAuth(req: Request, env: AppBindings, url: URL): Promise<Response> {
  if (url.pathname === '/auth/logout') {
    // Clear our cookie; also bounce through Access's own logout when we know the team.
    const dest = env.CF_ACCESS_TEAM
      ? `https://${env.CF_ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/logout`
      : '/admin'
    return new Response(null, {
      status: 302,
      headers: { Location: dest, 'Set-Cookie': cookieHeader('', 0) },
    })
  }

  if (url.pathname !== '/auth/login') return new Response('Not Found', { status: 404 })

  const secret = env.ADMIN_SESSION_SECRET
  if (!secret) return page('Admin login is not configured', 'This bot has no ADMIN_SESSION_SECRET set.', 503)

  const token = url.searchParams.get('token') ?? ''
  if (!token) return page('Missing login token', 'Open the link from <code>/party admin</code> in Discord again.', 400)

  const link = await consumeAdminLinkToken(env.DB, token)
  if (!link) {
    return page('Link expired or already used', 'Magic links are single-use and last 24 hours. Run <code>/party admin</code> in Discord for a fresh one.', 410)
  }

  // Re-check the allow-list (for this guild) at click time so de-listing takes
  // effect immediately.
  if (!(await isAdmin(env.DB, link.guildId, link.userId))) {
    return page('Access removed', 'Your Discord account is no longer on this server’s admin allow-list.', 403)
  }

  await touchAdminLogin(env.DB, link.guildId, link.userId)

  const value = await signSession(link.userId, link.displayName, link.guildId, secret)
  return new Response(null, {
    status: 302,
    headers: { Location: '/admin', 'Set-Cookie': cookieHeader(value, Math.floor(SESSION_TTL_MS / 1000)) },
  })
}

/** Small self-contained status page (no external assets — Access CSP-friendly). */
export function page(title: string, body: string, status = 200): Response {
  const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; font:15px/1.5 system-ui,sans-serif;
         background:#0b0b0f; color:#e7e7ea; }
  @media (prefers-color-scheme: light){ body{ background:#f6f6f8; color:#1a1a1f; } }
  .card { max-width:26rem; padding:2rem 2.25rem; border-radius:14px; background:rgba(127,127,140,.1);
          border:1px solid rgba(127,127,140,.25); text-align:center; }
  h1 { font-size:1.15rem; margin:.25rem 0 .75rem; }
  p { margin:0; opacity:.85; }
  code { background:rgba(127,127,140,.2); padding:.1em .4em; border-radius:5px; }
</style>
<div class="card"><h1>${esc(title)}</h1><p>${body}</p></div>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
}
