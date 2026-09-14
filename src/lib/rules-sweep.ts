import type { AppBindings } from '../types'
import { rulesAccess } from './rules'
import * as parties from '../store/parties'
import { trySyncEmbed } from './party'
import { addRole, removeRole } from './discord'
import { finishRoleChange, getRulesGate, pendingRoleChanges } from '../store/rules'

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
        if (changed) await trySyncEmbed(env.DISCORD_BOT_TOKEN, await parties.getParty(env.DB, guildId, party.id) ?? undefined)
      } catch (error) {
        console.warn(`Rules sweep deferred for ${guildId}/${party.id}:`, error)
      }
    }
  }
}

/**
 * Settle Discord roles for members the gate has approved or revoked.
 *
 * The Python bot noticed a role stripped by hand through a gateway event and
 * reacted at once. A Worker has no gateway, so this runs on the every-minute
 * trigger instead: approval in the database is the source of truth, and the
 * role is brought back in line behind it. Queue access never waits on this —
 * it reads the database directly.
 */
export async function applyPendingRoles(env: AppBindings): Promise<void> {
  const pending = await pendingRoleChanges(env.DB)
  if (pending.length === 0) return

  const roles = new Map<string, string | undefined>()
  for (const { guildId, userId, state } of pending.slice(0, 50)) {
    if (!roles.has(guildId)) roles.set(guildId, (await getRulesGate(env.DB, guildId))?.roleId)
    const roleId = roles.get(guildId)
    if (!roleId) continue
    try {
      if (state === 'granting') await addRole(env.DISCORD_BOT_TOKEN, guildId, userId, roleId)
      else await removeRole(env.DISCORD_BOT_TOKEN, guildId, userId, roleId)
      await finishRoleChange(env.DB, guildId, userId, state)
    } catch (e) {
      // Left pending on purpose: the next tick tries again.
      console.warn(`rules role ${state} still pending for ${userId} in ${guildId}:`, e)
    }
  }
}
