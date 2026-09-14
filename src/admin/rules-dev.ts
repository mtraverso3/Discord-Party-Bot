/**
 * TEMPORARY — local preview of the rules panel.
 *
 * The Rules & verification tab is a console for the separate Python bot, so
 * without that service running there is nothing to look at. When
 * RULES_BOT_DEV_STUB is set (in .dev.vars) and the request is addressed to
 * localhost, handleRulesAdmin swaps only its outbound fetch for this in-memory
 * stand-in: every check, guild scope rule and database write in rules.ts still
 * runs for real, and only the Python service is faked.
 *
 * The quiz content is the real content.py, so the preview shows what members
 * would actually read. Delete this file and its one call site in rules.ts to
 * remove the whole thing.
 */

import { DEV_RULES_CONFIG } from './rules-dev-config'

interface StubMember {
  user_id: string
  state: string
  generation: number
  revocations: number
  completions: number
  version: string | null
  accepted_at: string | null
}

interface StubEvent {
  id: number
  user_id: string
  kind: string
  actor_id: string | null
  reason: string
  created_at: string
}

const GUILD_ID = '111111111111111111'
const ROLE_ID = '222222222222222222'
const CHANNEL_ID = '333333333333333333'

let config: any = DEV_RULES_CONFIG

const members = new Map<string, StubMember>([
  ['200000000000000001', { user_id: '200000000000000001', state: 'approved', generation: 0, revocations: 0, completions: 1, version: '1', accepted_at: '2026-09-01T18:20:00+00:00' }],
  ['200000000000000002', { user_id: '200000000000000002', state: 'approved', generation: 2, revocations: 1, completions: 2, version: '1', accepted_at: '2026-09-09T20:05:00+00:00' }],
  ['200000000000000003', { user_id: '200000000000000003', state: 'unapproved', generation: 1, revocations: 0, completions: 0, version: null, accepted_at: null }],
])

const history = new Map<string, StubEvent[]>([
  ['200000000000000001', [
    { id: 3, user_id: '200000000000000001', kind: 'verified', actor_id: '200000000000000001', reason: 'Completed quiz and agreement', created_at: '2026-09-01T18:20:00+00:00' },
  ]],
  ['200000000000000002', [
    { id: 7, user_id: '200000000000000002', kind: 'verified', actor_id: '200000000000000002', reason: 'Completed quiz and agreement', created_at: '2026-09-09T20:05:00+00:00' },
    { id: 5, user_id: '200000000000000002', kind: 'revoked', actor_id: null, reason: 'Left lobby mid-series', created_at: '2026-09-05T22:40:00+00:00' },
  ]],
])

let nextEventId = 100

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Stands in for one request to the Python management service. */
export async function devRulesUpstream(url: URL, init: RequestInit): Promise<Response> {
  const path = url.pathname.replace(/\/$/, '')
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = (init.headers ?? {}) as Record<string, string>
  const actor = headers['X-Arena-Actor'] ?? 'Admin panel'
  const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : {}

  if (path === '/status') {
    const list = [...members.values()]
    return json({
      online: true,
      guildId: GUILD_ID,
      roleId: ROLE_ID,
      channelId: CHANNEL_ID,
      config,
      counts: {
        total: list.length,
        approved: list.filter(m => m.state === 'approved').length,
        pending: list.filter(m => m.state === 'granting' || m.state === 'revoking').length,
      },
    })
  }

  if (path === '/publish' && method === 'POST') {
    if (body.expectedVersion !== config.version) {
      return json({ error: 'Another admin published changes. Reload before editing.' }, 409)
    }
    const version = String(Number(config.version) + 1)
    config = { ...body.config, version }
    let requeued = 0
    if (body.requireReapproval) {
      for (const member of members.values()) {
        if (member.state === 'approved') {
          member.state = 'revoking'
          member.generation++
          requeued++
        }
      }
    }
    const message = body.requireReapproval
      ? 'Published version ' + version + '. ' + requeued + ' member(s) must verify again; role removals are queued.'
      : 'Published version ' + version + '. Existing approvals stay valid.'
    return json({ message, version })
  }

  if (path === '/post' && method === 'POST') {
    return json({ message: 'Posted the rules check message in channel ' + CHANNEL_ID + '.' })
  }

  const member = path.match(/^\/members\/(\d{5,20})(?:\/(revoke|reset))?$/)
  if (member) {
    const id = member[1]!
    const record = members.get(id) ?? {
      user_id: id, state: 'unapproved', generation: 0, revocations: 0, completions: 0, version: null, accepted_at: null,
    }
    members.set(id, record)

    if (!member[2]) return json({ member: record, history: history.get(id) ?? [] })

    const disciplinary = member[2] === 'revoke'
    const wasActive = record.state === 'approved' || record.state === 'granting'
    if (disciplinary && wasActive) record.revocations++
    record.state = wasActive ? 'revoking' : 'unapproved'
    record.generation++
    history.set(id, [
      {
        id: nextEventId++,
        user_id: id,
        kind: disciplinary && wasActive ? 'revoked' : 'reset',
        actor_id: null,
        reason: String(body.reason ?? '') + ' (by ' + actor + ')',
        created_at: new Date().toISOString(),
      },
      ...(history.get(id) ?? []),
    ])
    return json({
      message: disciplinary && wasActive
        ? 'Approval revoked. The role removal is queued.'
        : 'Member must take the rules check again. No disciplinary count was added.',
      pending: true,
    })
  }

  return json({ error: 'Not found' }, 404)
}
