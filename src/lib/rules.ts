import type { AppBindings } from '../types'

export class RulesAccessError extends Error {
  constructor(message = 'Complete the rules check in #arena-rules before joining or being selected.') {
    super(message)
    this.name = 'RulesAccessError'
  }
}

export interface RulesAccess {
  /** null means this server has no role gate; [] means nobody checked is approved. */
  eligible(guildId: string, userIds: string[]): Promise<string[] | null>
  require(guildId: string, userId: string): Promise<void>
}

/** One policy per operation; never cache an approval across requests. */
export function rulesAccess(env: AppBindings): RulesAccess {
  const eligible = async (guildId: string, userIds: string[]): Promise<string[] | null> => {
    const panel = await env.DB.prepare('SELECT role_id,enabled FROM rules_gate WHERE guild_id=?1').bind(guildId).first<{ role_id: string; enabled: number }>()
    if (panel && !panel.enabled) return null
    if (!panel && !env.RULES_APPROVAL_ROLES) return null
    let mapping: Record<string, string>
    try {
      mapping = panel ? { [guildId]: panel.role_id } : JSON.parse(env.RULES_APPROVAL_ROLES!)
      if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object'
          || Object.entries(mapping).some(([guild, role]) => !/^\d{5,25}$/.test(guild)
            || typeof role !== 'string' || !/^\d{5,25}$/.test(role))) throw new Error('Invalid mapping')
    } catch {
      throw new RulesAccessError('Rules verification is misconfigured. Ask a moderator to check RULES_APPROVAL_ROLES.')
    }
    const roleId = mapping[guildId]
    if (!roleId) return null
    const allowed: string[] = []
    // Bounded concurrency keeps a large queue from bursting Discord's member route.
    const ids = [...new Set(userIds)]
    for (let offset = 0; offset < ids.length; offset += 3) {
      await Promise.all(ids.slice(offset, offset + 3).map(async userId => {
        const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
          headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
          signal: AbortSignal.timeout(8000),
        }).catch(() => { throw new RulesAccessError('Discord could not verify rules approval. Please try again shortly.') })
        if (response.status === 404) return
        if (!response.ok) throw new RulesAccessError('Discord could not verify rules approval. Please try again shortly.')
        const member = await response.json<{ roles?: unknown }>()
        if (!Array.isArray(member.roles)) throw new RulesAccessError('Discord returned an incomplete rules approval check. Please retry.')
        if (member.roles.includes(roleId)) allowed.push(userId)
      }))
    }
    return allowed
  }
  return {
    eligible,
    async require(guildId, userId) {
      const result = await eligible(guildId, [userId])
      if (result !== null && !result.includes(userId)) throw new RulesAccessError()
    },
  }
}

export function rulesErrorMessage(error: unknown): string | null {
  return error instanceof RulesAccessError ? error.message : null
}
