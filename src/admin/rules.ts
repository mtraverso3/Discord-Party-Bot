import type { AppBindings } from '../types'
import { formatStatus, postRulesMessage } from '../commands/rules'
import { removeRole } from '../lib/discord'
import {
  getMember, getRulesConfig, getRulesGate, listMembers, memberCounts, memberHistory,
  publishRulesConfig, revokeApproval, saveRulesGate,
} from '../store/rules'

/**
 * The dashboard's rules routes. These used to proxy to the Python bot's admin
 * service over an HTTPS tunnel; the state is in this Worker's database now, so
 * they read and write it directly. The routes and response shapes are
 * unchanged, so the Rules tab did not have to be rewritten with them.
 *
 * Called only after the existing Access authentication and guild authorization.
 */

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export async function handleRulesAdmin(
  req: Request, env: AppBindings, guildId: string, path: string, actor: string,
): Promise<Response> {
  const method = req.method.toUpperCase()

  // A browser form on another origin must not be able to drive these.
  const origin = req.headers.get('origin')
  if (method !== 'GET' && origin && origin !== new URL(req.url).origin) {
    return json({ error: 'Cross-origin changes are not allowed.' }, 403)
  }

  let body: any = {}
  if (method === 'POST') {
    if (!req.headers.get('content-type')?.includes('application/json')) {
      return json({ error: 'JSON body required.' }, 400)
    }
    const text = await req.text()
    if (text.length > 131072) return json({ error: 'Request too large.' }, 413)
    try { body = text ? JSON.parse(text) : {} } catch { return json({ error: 'Invalid JSON.' }, 400) }
  }

  if (path === '/rules/status' && method === 'GET') return await status(env, guildId)
  if (path === '/rules/members' && method === 'GET') return await roster(env, guildId)
  if (path === '/rules/connect' && method === 'POST') return await connect(env, guildId, body)
  if (path === '/rules/publish' && method === 'POST') return await publish(env, guildId, body, actor)
  if (path === '/rules/post' && method === 'POST') return await post(env, guildId, body)

  const member = path.match(/^\/rules\/members\/(\d{5,20})(?:\/(revoke|reset))?$/)
  if (member) {
    const userId = member[1]!
    if (!member[2] && method === 'GET') return await memberDetail(env, guildId, userId)
    if (member[2] && method === 'POST') {
      return await changeApproval(env, guildId, userId, member[2] === 'revoke', body, actor)
    }
  }
  return json({ error: 'Not found' }, 404)
}

async function status(env: AppBindings, guildId: string): Promise<Response> {
  const [config, gate, counts] = await Promise.all([
    getRulesConfig(env.DB, guildId),
    getRulesGate(env.DB, guildId),
    memberCounts(env.DB, guildId),
  ])
  return json({
    // Always "online" now: the rules check is this Worker, so if the dashboard
    // loaded at all, it is running.
    online: true,
    guildId,
    roleId: gate?.roleId ?? '',
    channelId: gate?.channelId ?? '',
    queueConnected: !!gate?.enabled,
    config,
    counts,
  })
}

async function roster(env: AppBindings, guildId: string): Promise<Response> {
  const members = await listMembers(env.DB, guildId)
  return json({
    members: members.map(m => ({
      user_id: m.user_id,
      state: m.state,
      revocations: m.revocations,
      completions: m.completions,
      version: m.version === null ? null : String(m.version),
    })),
  })
}

/** Switch the gate on for this guild — the panel's "Connect queue" button. */
async function connect(env: AppBindings, guildId: string, body: any): Promise<Response> {
  const roleId = (body?.roleId ?? '').toString().trim()
  if (roleId && !/^\d{5,25}$/.test(roleId)) return json({ error: 'That is not a valid role ID.' }, 400)
  await saveRulesGate(env.DB, guildId, { enabled: true, ...(roleId ? { roleId } : {}) })
  return await status(env, guildId)
}

async function publish(env: AppBindings, guildId: string, body: any, actor: string): Promise<Response> {
  const expected = Number(body?.expectedVersion)
  if (!Number.isInteger(expected)) return json({ error: 'Reload before publishing.' }, 400)
  const result = await publishRulesConfig(
    env.DB, guildId, body?.config, expected, body?.requireReapproval === true, actor,
  )
  if (!result.ok) return json({ error: result.error }, result.conflict ? 409 : 400)
  const message = result.requeued > 0
    ? `Published version ${result.config.version}. ${result.requeued} member(s) must take the check again.`
    : `Published version ${result.config.version}. Existing approvals stay valid.`
  return json({ ok: true, version: result.config.version, message })
}

async function post(env: AppBindings, guildId: string, body: any): Promise<Response> {
  const gate = await getRulesGate(env.DB, guildId)
  const channelId = (body?.channelId ?? '').toString().trim() || gate?.channelId
  if (!channelId) return json({ error: 'Pick the channel to post the rules check in.' }, 400)
  if (!/^\d{5,25}$/.test(channelId)) return json({ error: 'That is not a valid channel ID.' }, 400)
  try {
    await postRulesMessage(env, guildId, channelId)
  } catch (e) {
    console.error('rules post failed:', e)
    return json({ error: "Could not post there — check the bot's permissions in that channel." }, 502)
  }
  await saveRulesGate(env.DB, guildId, { channelId })
  return json({ ok: true, message: 'Rules check posted in the configured Discord channel.' })
}

async function memberDetail(env: AppBindings, guildId: string, userId: string): Promise<Response> {
  const [member, history] = await Promise.all([
    getMember(env.DB, guildId, userId),
    memberHistory(env.DB, guildId, userId),
  ])
  return json({
    member: {
      user_id: member.user_id,
      state: member.state,
      revocations: member.revocations,
      completions: member.completions,
      version: member.version === null ? null : String(member.version),
      summary: formatStatus(member),
    },
    history: history.map(e => ({
      id: e.id,
      user_id: e.userId,
      kind: e.kind,
      actor_id: e.actor ?? null,
      reason: e.reason,
      created_at: new Date(e.createdAt).toISOString(),
    })),
  })
}

async function changeApproval(
  env: AppBindings, guildId: string, userId: string, disciplinary: boolean, body: any, actor: string,
): Promise<Response> {
  const reason = (body?.reason ?? '').toString().trim().slice(0, 500)
  if (!reason) return json({ error: 'Give a reason — it is recorded against the member.' }, 400)

  const gate = await getRulesGate(env.DB, guildId)
  const roleId = gate?.roleId
  const { counted, pending } = await revokeApproval(
    env.DB, guildId, userId, actor, reason, disciplinary, !!roleId,
  )

  let stillPending = pending
  if (pending && roleId) {
    try {
      await removeRole(env.DISCORD_BOT_TOKEN, guildId, userId, roleId)
      await env.DB.prepare(
        "UPDATE rules_members SET state = 'unapproved' WHERE guild_id = ?1 AND user_id = ?2 AND state = 'revoking'",
      ).bind(guildId, userId).run()
      stillPending = false
    } catch (e) {
      console.warn(`rules role removal pending for ${userId} in ${guildId}:`, e)
    }
  }

  const base = disciplinary
    ? `Approval removed. Lifetime revocations: ${counted ? 'increased by 1' : 'unchanged'}.`
    : 'The member must take the rules check again. No disciplinary count was added.'
  return json({
    ok: true,
    pending: stillPending,
    message: stillPending
      ? base + ' Their Discord role could not be removed yet and will be retried — queue access is already blocked.'
      : base,
  })
}
