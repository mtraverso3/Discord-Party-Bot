import type { AppBindings, PartyData } from '../types'
import { rulesAccess } from './rules'
import * as parties from '../store/parties'
import { trySyncEmbed } from './party'
import { sendDirectMessage } from './discord'

function removalNotice(party: PartyData): string {
  const lines = [
    `You were removed from **${party.name}** because it requires this server's rules check and you no longer have approval.`,
    'To get back in, take the check with `/party rules quiz`.',
  ]
  if (party.embedChannelId && party.embedMessageId) {
    lines.push(`https://discord.com/channels/${party.guildId}/${party.embedChannelId}/${party.embedMessageId}`)
  }
  return lines.join('\n')
}

/** The sweep runs from cron, so a DM is the only way to tell them. */
async function notifyRemoved(env: AppBindings, party: PartyData, userId: string): Promise<void> {
  try {
    await sendDirectMessage(env.DISCORD_BOT_TOKEN, userId, { content: removalNotice(party) })
  } catch (error) {
    console.warn(`Rules sweep DM failed for ${userId} in ${party.guildId}/${party.id}:`, error)
  }
}

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
            const { status } = await parties.leaveParty(env.DB, guildId, party.id, member.userId, 'removed', policy)
            if (status === 'left' || status === 'dequeued') await notifyRemoved(env, party, member.userId)
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
