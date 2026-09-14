import type { AppBindings } from '../types'
import { devRulesUpstream } from './rules-dev'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

/** Called only after the existing Access authentication and guild authorization. */
export async function handleRulesAdmin(req: Request, env: AppBindings, guildId: string, path: string, actor: string): Promise<Response> {
  if (req.method !== 'GET' && req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin) {
    return json({ error: 'Cross-origin changes are not allowed.' }, 403)
  }
  const routes: Record<string, string> = { '/rules/status': '/status', '/rules/publish': '/publish', '/rules/post': '/post', '/rules/members': '/members' }
  const member = path.match(/^\/rules\/members\/(\d{5,20})(\/(revoke|reset))?$/)
  const upstreamPath = routes[path] ?? (member ? `/members/${member[1]}${member[2] ?? ''}` : null)
  const connect = path === '/rules/connect' && req.method === 'POST'
  const allowed = path === '/rules/status' || path === '/rules/members' ? req.method === 'GET'
    : member ? (member[2] ? req.method === 'POST' : req.method === 'GET')
      : (path === '/rules/publish' || path === '/rules/post') && req.method === 'POST'
  if (!connect && (!upstreamPath || !allowed)) return json({ error: 'Not found' }, 404)
  if (!env.RULES_BOT_API_URL || !env.RULES_BOT_API_TOKEN) {
    return json({ error: 'The rules bot is not connected yet. Ask the person who deploys the bot to complete the one-time connection setup.' }, 503)
  }
  let base: URL
  try {
    base = new URL(env.RULES_BOT_API_URL)
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error()
  } catch { return json({ error: 'The rules service connection needs attention from the person who deploys the bot.' }, 503) }

  // Never accept an upstream URL, token, guild, or actor supplied by the browser.
  const url = new URL(base.origin + base.pathname.replace(/\/$/, '') + (connect ? '/status' : upstreamPath))
  let body: unknown
  if (req.method === 'POST') {
    if (!req.headers.get('content-type')?.includes('application/json')) return json({ error: 'JSON body required.' }, 400)
    if (Number(req.headers.get('content-length') || 0) > 131072) return json({ error: 'Request too large.' }, 413)
    const text = await req.text()
    if (text.length > 131072) return json({ error: 'Request too large.' }, 413)
    try { body = JSON.parse(text) } catch { return json({ error: 'Invalid JSON.' }, 400) }
  }
  // TEMPORARY (local preview): swap only the call to the Python service — every
  // check above and every database write below still runs. See rules-dev.ts.
  const devStub = env.RULES_BOT_DEV_STUB
    && ['localhost', '127.0.0.1'].includes(new URL(req.url).hostname)

  let response: Response
  try {
    const request = {
      method: connect ? 'GET' : req.method,
      headers: { Authorization: `Bearer ${env.RULES_BOT_API_TOKEN}`, 'X-Arena-Guild': guildId,
        'X-Arena-Actor': actor, 'Content-Type': 'application/json' },
      body: req.method === 'POST' && !connect ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000), redirect: 'error' as const,
    }
    response = devStub ? await devRulesUpstream(url, request) : await fetch(url.toString(), request)
  } catch { return json({ error: 'The rules bot could not be reached. If you submitted a change, refresh its status before retrying.' }, 503) }
  let data: any
  try { data = await response.json() }
  catch { return json({ error: 'The rules bot returned an unreadable response.' }, 502) }
  if (response.status === 401 || response.status === 403) return json({ error: 'Rules bot connection credentials or server scope need attention from the person who deploys the bot.' }, 503)
  if (!response.ok) return json({ error: typeof data?.error === 'string' ? data.error : 'Rules bot action failed.' }, response.status)
  if (connect || path === '/rules/status') {
    if (data.guildId !== guildId || !/^\d{5,20}$/.test(data.roleId ?? '')) return json({ error: 'The connected rules bot does not match this server.' }, 503)
    if (connect) {
      await env.DB.prepare('INSERT INTO rules_gate(guild_id,role_id,enabled) VALUES (?1,?2,1) ON CONFLICT(guild_id) DO UPDATE SET role_id=?2,enabled=1')
        .bind(guildId, data.roleId).run()
    }
    const gate = await env.DB.prepare('SELECT role_id,enabled FROM rules_gate WHERE guild_id=?1').bind(guildId).first<{ role_id: string; enabled: number }>()
    // The legacy secret still works during migration; panel connection takes priority.
    let legacy: string | undefined
    try { legacy = JSON.parse(env.RULES_APPROVAL_ROLES || '{}')[guildId] } catch { /* reported by existing queue policy */ }
    data.queueConnected = gate ? !!gate.enabled && gate.role_id === data.roleId : legacy === data.roleId
  }
  return json(data, response.status)
}
