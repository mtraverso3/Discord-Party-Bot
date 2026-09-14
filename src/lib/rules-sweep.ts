import type { AppBindings } from '../types'
import { rulesAccess } from './rules'
import * as parties from '../store/parties'
import { trySyncEmbed } from './party'

/** Remove confirmed-unapproved entries. API failures leave data intact for retry. */
export async function sweepRulesApproval(env: AppBindings): Promise<void> {
  const policy = rulesAccess(env)
  const guilds = await env.DB.prepare('SELECT DISTINCT guild_id FROM parties').all<{ guild_id: string }>()
  for (const { guild_id: guildId } of guilds.results) {
    for (const party of await parties.listParties(env.DB, guildId)) {
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
        if (changed) await trySyncEmbed(env.DISCORD_BOT_TOKEN, await parties.getParty(env.DB, guildId, party.id) ?? undefined)
      } catch (error) {
        console.warn(`Rules sweep deferred for ${guildId}/${party.id}:`, error)
      }
    }
  }
}
