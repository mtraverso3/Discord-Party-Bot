// A tiny OpenID Connect provider, just big enough for Cloudflare Access to use
// as a generic OIDC login method. It authenticates the browser purely from the
// admin session cookie set by the magic-link landing (src/auth/session.ts) —
// there is no password, no Discord OAuth. The Discord slash-command interaction
// that minted the link is the proof of identity.
//
// Flow (all endpoints live OUTSIDE the Access-protected /admin*):
//   GET  /.well-known/openid-configuration   discovery (auto-configures Access)
//   GET  /oidc/jwks                           public key to verify our id_tokens
//   GET  /oidc/authorize                      Access redirects here; we read the
//                                             session cookie and mint an auth code
//   POST /oidc/token                          Access exchanges the code for an id_token
//   GET  /oidc/userinfo                       Access may fetch claims here too
//
// The id_token carries a synthetic email (`<discordId>@<guildId>.discord.local`)
// so the existing Access-JWT path and audit log attribute actions to the Discord
// user; the guild subdomain pins a magic-link admin to the one guild that minted
// their link (see src/admin/api.ts).

import type { AppBindings } from '../types'
import { publicJwk, signRs256, verifyRs256, sha256B64url, type RsaPrivateJwk } from '../lib/jwt'
import { consumeOidcCode, generateOidcCode, isAdmin, writeOidcCode } from '../store/adminAuth'
import { readSession, page, normalizeBaseUrl } from './session'

const ID_TOKEN_TTL_S = 60 * 60
const SUPPORTED_SCOPES = 'openid email profile'

interface OidcConfig {
  issuer: string
  clientId: string
  clientSecret: string
  jwk: RsaPrivateJwk
  kid: string
  emailDomain: string
  redirectUris: Set<string>
}

/** Assemble config from env, or null when the feature isn't fully configured. */
function config(env: AppBindings): OidcConfig | null {
  const { PUBLIC_BASE_URL, ADMIN_SESSION_SECRET, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_PRIVATE_JWK } = env
  if (!PUBLIC_BASE_URL || !ADMIN_SESSION_SECRET || !OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET || !OIDC_PRIVATE_JWK) {
    return null
  }
  let jwk: RsaPrivateJwk
  try {
    jwk = JSON.parse(OIDC_PRIVATE_JWK)
  } catch {
    console.error('OIDC_PRIVATE_JWK is not valid JSON')
    return null
  }
  const redirectUris = new Set<string>()
  if (env.OIDC_REDIRECT_URI) redirectUris.add(env.OIDC_REDIRECT_URI)
  if (env.CF_ACCESS_TEAM) redirectUris.add(`https://${env.CF_ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/callback`)
  return {
    issuer: normalizeBaseUrl(PUBLIC_BASE_URL),
    clientId: OIDC_CLIENT_ID,
    clientSecret: OIDC_CLIENT_SECRET,
    jwk,
    kid: jwk.kid ?? 'pb-oidc',
    emailDomain: env.OIDC_EMAIL_DOMAIN || 'discord.local',
    redirectUris,
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export async function handleOidc(req: Request, env: AppBindings, url: URL): Promise<Response> {
  const cfg = config(env)
  if (!cfg) return json({ error: 'server_error', error_description: 'OIDC login not configured' }, 503)

  switch (url.pathname) {
    case '/.well-known/openid-configuration': return discovery(cfg)
    case '/oidc/jwks':      return json({ keys: [publicJwk(cfg.jwk)] })
    case '/oidc/authorize': return await authorize(req, env, url, cfg)
    case '/oidc/token':     return await token(req, env, cfg)
    case '/oidc/userinfo':  return await userinfo(req, cfg)
    default:                return json({ error: 'not_found' }, 404)
  }
}

function discovery(cfg: OidcConfig): Response {
  return json({
    issuer: cfg.issuer,
    authorization_endpoint: `${cfg.issuer}/oidc/authorize`,
    token_endpoint: `${cfg.issuer}/oidc/token`,
    userinfo_endpoint: `${cfg.issuer}/oidc/userinfo`,
    jwks_uri: `${cfg.issuer}/oidc/jwks`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    scopes_supported: ['openid', 'email', 'profile'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    claims_supported: ['sub', 'email', 'email_verified', 'name'],
  })
}

async function authorize(req: Request, env: AppBindings, url: URL, cfg: OidcConfig): Promise<Response> {
  const q = url.searchParams
  const clientId = q.get('client_id')
  const redirectUri = q.get('redirect_uri') ?? ''
  const state = q.get('state')
  const nonce = q.get('nonce')
  const responseType = q.get('response_type')
  const codeChallenge = q.get('code_challenge')
  const codeChallengeMethod = q.get('code_challenge_method')

  // These come from the (untrusted) redirect, so validate before trusting them
  // enough to redirect back — never bounce to an unregistered redirect_uri.
  if (clientId !== cfg.clientId) return page('Login error', 'Unknown OIDC client.', 400)
  if (!cfg.redirectUris.has(redirectUri)) return page('Login error', 'Unrecognized redirect URI.', 400)
  if (responseType !== 'code') return redirectError(redirectUri, state, 'unsupported_response_type')
  if (codeChallenge && codeChallengeMethod && codeChallengeMethod !== 'S256') {
    return redirectError(redirectUri, state, 'invalid_request', 'only S256 PKCE is supported')
  }

  const session = env.ADMIN_SESSION_SECRET ? await readSession(req, env.ADMIN_SESSION_SECRET) : null
  if (!session) {
    return page(
      'Sign in from Discord',
      'Run <code>/party admin</code> in Discord and open the link it gives you, then this page will sign you in automatically.',
      401,
    )
  }
  // Enforce the allow-list again — a still-valid cookie shouldn't outlive removal
  // — scoped to the guild the session was minted for.
  if (!(await isAdmin(env.DB, session.gid, session.uid))) {
    return page('Access removed', 'Your Discord account is no longer on this server’s admin allow-list.', 403)
  }

  const code = generateOidcCode()
  await writeOidcCode(env.DB, code, {
    guildId: session.gid,
    userId: session.uid,
    displayName: session.name,
    nonce,
    codeChallenge,
    redirectUri,
  })

  const back = new URL(redirectUri)
  back.searchParams.set('code', code)
  if (state) back.searchParams.set('state', state)
  return Response.redirect(back.toString(), 302)
}

function redirectError(redirectUri: string, state: string | null, error: string, description?: string): Response {
  const back = new URL(redirectUri)
  back.searchParams.set('error', error)
  if (description) back.searchParams.set('error_description', description)
  if (state) back.searchParams.set('state', state)
  return Response.redirect(back.toString(), 302)
}

async function token(req: Request, env: AppBindings, cfg: OidcConfig): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'invalid_request' }, 405)

  const form = await req.formData()
  const field = (k: string): string => { const v = form.get(k); return typeof v === 'string' ? v : '' }
  if (field('grant_type') !== 'authorization_code') return json({ error: 'unsupported_grant_type' }, 400)

  // Client auth: HTTP Basic (client_secret_basic) or form body (client_secret_post).
  const creds = clientCreds(req, field)
  if (creds.id !== cfg.clientId || creds.secret !== cfg.clientSecret) {
    return json({ error: 'invalid_client' }, 401)
  }

  const rec = await consumeOidcCode(env.DB, field('code'))
  if (!rec) return json({ error: 'invalid_grant', error_description: 'code invalid or expired' }, 400)

  if (field('redirect_uri') !== rec.redirectUri) {
    return json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400)
  }

  if (rec.codeChallenge) {
    const verifier = field('code_verifier')
    if (!verifier || (await sha256B64url(verifier)) !== rec.codeChallenge) {
      return json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400)
    }
  }

  const now = Math.floor(Date.now() / 1000)
  // Encode the scoped guild into the synthetic email's subdomain. The admin API
  // parses it back out to pin a magic-link admin to their one guild; the Access
  // JWT reliably forwards `email`, so this is how the scope survives the hop
  // through Cloudflare Access. Super admins log in with a real email instead.
  const email = `${rec.userId}@${rec.guildId}.${cfg.emailDomain}`
  const base = {
    iss: cfg.issuer,
    sub: rec.userId,
    aud: cfg.clientId,
    iat: now,
    exp: now + ID_TOKEN_TTL_S,
    email,
    email_verified: true,
    name: rec.displayName,
  }

  const idToken = await signRs256(cfg.jwk, rec.nonce ? { ...base, nonce: rec.nonce } : base, cfg.kid)
  const accessToken = await signRs256(cfg.jwk, { ...base, token_use: 'access', scope: SUPPORTED_SCOPES }, cfg.kid)

  return json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ID_TOKEN_TTL_S,
    id_token: idToken,
    scope: SUPPORTED_SCOPES,
  })
}

function clientCreds(req: Request, field: (k: string) => string): { id: string; secret: string } {
  const auth = req.headers.get('Authorization') ?? ''
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6))
      const i = decoded.indexOf(':')
      if (i !== -1) {
        return { id: decodeURIComponent(decoded.slice(0, i)), secret: decodeURIComponent(decoded.slice(i + 1)) }
      }
    } catch { /* fall through to body */ }
  }
  return { id: field('client_id'), secret: field('client_secret') }
}

async function userinfo(req: Request, cfg: OidcConfig): Promise<Response> {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const claims = token ? await verifyRs256<{ sub: string; email: string; name: string }>(token, cfg.jwk) : null
  if (!claims) return json({ error: 'invalid_token' }, 401)
  return json({ sub: claims.sub, email: claims.email, email_verified: true, name: claims.name })
}
