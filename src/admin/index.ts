import type { AppBindings } from '../types'
import { verifyAccessJwt } from './access'
import { handleAdminApi } from './api'
import { ADMIN_HTML } from './html'

export async function handleAdmin(req: Request, env: AppBindings): Promise<Response> {
  const team = env.CF_ACCESS_TEAM
  const aud = env.CF_ACCESS_AUD
  if (!team || !aud) {
    return new Response(
      'Admin UI disabled — set CF_ACCESS_TEAM and CF_ACCESS_AUD env vars.',
      { status: 503 },
    )
  }

  const jwt = req.headers.get('cf-access-jwt-assertion')
  if (!jwt) return new Response('Forbidden — request did not come through Cloudflare Access', { status: 403 })
  const verify = await verifyAccessJwt(jwt, team, aud)
  if (!verify.ok) return new Response('Forbidden — invalid Access token', { status: 403 })

  const url = new URL(req.url)
  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    return new Response(ADMIN_HTML, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Don't let browsers cache the page; the JS picks up new server state on each load.
        'Cache-Control': 'no-store',
      },
    })
  }
  if (url.pathname.startsWith('/admin/api/')) {
    return handleAdminApi(req, env, url, verify.email)
  }
  return new Response('Not Found', { status: 404 })
}
