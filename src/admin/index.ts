import type { AppBindings } from '../types'
import { verifyAccessJwt } from './access'
import { handleAdminApi } from './api'

export async function handleAdmin(req: Request, env: AppBindings): Promise<Response> {
  const url = new URL(req.url)
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

  if (url.pathname.startsWith('/admin/api/')) {
    return handleAdminApi(req, env, url, verify.email)
  }
  return serveSpa(req, env, url)
}

/**
 * Serve the built admin SPA (admin-ui/dist) from the Worker's static assets
 * binding. The SPA is built with base '/admin/', so we strip that prefix
 * before hitting the binding; anything that isn't a real asset file falls
 * back to index.html (client-side routing).
 */
async function serveSpa(req: Request, env: AppBindings, url: URL): Promise<Response> {
  if (!env.ASSETS) {
    return new Response('Admin UI assets not built — run `npm run build:admin` and redeploy.', { status: 503 })
  }

  const assetUrl = new URL(url)
  assetUrl.pathname = url.pathname.slice('/admin'.length) || '/'

  let res = await env.ASSETS.fetch(new Request(assetUrl.toString(), req))
  if (res.status === 404) {
    assetUrl.pathname = '/'
    res = await env.ASSETS.fetch(new Request(assetUrl.toString(), req))
  }

  if ((res.headers.get('content-type') || '').includes('text/html')) {
    // Don't let browsers cache the shell; hashed JS/CSS assets stay cacheable.
    res = new Response(res.body, res)
    res.headers.set('Cache-Control', 'no-store')
  }
  return res
}
