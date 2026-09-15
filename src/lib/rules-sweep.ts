import type { AppBindings } from '../types'
import { rulesAccess } from './rules'
import * as parties from '../store/parties'
import { trySyncEmbed } from './party'

/** Remove confirmed-unapproved entries. API failures leave data intact for retry. */
export async function sweepRulesApproval(env: AppBindings): Promise<void> {
  const policy = rulesAccess(env)
  const guilds = await env.DB.prepare(`
    SELECT DISTINCT p.guild_id FROM parties p
    JOIN rules_gate g ON g.guild_id = p.guild_id AND g.enabled = 1
    WHERE p.rules_required = 1
  `).all<{ guild_id: string }>()
  for (const { guild_id: guildId } of guilds.results) {
    for (const party of await parties.listParties(env.DB, guildId)) {
      if (!party.rulesRequired) continue
      try {
        const roster = [...party.members, ...party.queue]
        const allowed = await policy.eligible(guildId, roster.map(m => m.userId))
        if (allowed === null) continue
        const ids = new Set(allowed)
        let changed = false
        // Remove queued entries first so none is promoted by a later member removal.
        for (const member of [...party.queue, ...party.members]) {
          if (ids.has(member.userId)) continue
          if (member.userId === party.ownerId) {
            // Preserve the party for moderator repair instead of deleting everyone's queue.
            await parties.closeParty(env.DB, guildId, party.id, party.ownerId)
          } else {
            await parties.leaveParty(env.DB, guildId, party.id, member.userId, 'removed', policy)
          }
          changed = true
        }
        if (changed) await trySyncEmbed(env, await parties.getParty(env.DB, guildId, party.id) ?? undefined)
      } catch (error) {
        console.warn(`Rules sweep deferred for ${guildId}/${party.id}:`, error)
      }
    }
  }
}
