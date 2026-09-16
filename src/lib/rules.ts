import type { AppBindings } from '../types'
import { filterApproved, filterRevoked, getRulesGate } from '../store/rules'
import { filterAdmins } from '../store/adminAuth'

// Whether a member may be admitted to a party. Approval is a row in this
// Worker's database, so a check is one indexed query.
//
// Admins on the bot's own admin list are let through without passing, so the
// people responsible for the rules cannot be locked out by them. They are
// warned instead; see exemptFromRules, which the reply paths use to add that
// warning. Two limits on the exemption:
//
//  - It covers never having taken the check, not having had approval revoked.
//    A revoked admin takes the quiz like anyone else; "require retake without
//    penalty" is the undo for a moderator who does not want that.
//  - It follows the person being admitted, not whoever is acting. An admin
//    adding an unapproved member is still refused.

export class RulesAccessError extends Error {
  // Also shown in the dashboard and the desktop client, so no Discord markdown.
  constructor(message = "Pass this server's rules check first. Take it in Discord with /party rules quiz, or the Start button in the rules channel.") {
    super(message)
    this.name = 'RulesAccessError'
  }
}

export interface RulesAccess {
  /** null means this guild has no gate; [] means nobody checked is approved. */
  eligible(guildId: string, userIds: string[]): Promise<string[] | null>
  require(guildId: string, userId: string): Promise<void>
}

/** One policy per operation; never cache an approval across requests. */
export function rulesAccess(env: AppBindings): RulesAccess {
  // The gate is re-read per guild, not per call: the sweep asks about many
  // parties in one guild and a single operation must see one consistent answer.
  const gates = new Map<string, Promise<Awaited<ReturnType<typeof getRulesGate>>>>()
  const gateFor = (guildId: string) => {
    let pending = gates.get(guildId)
    if (!pending) {
      pending = getRulesGate(env.DB, guildId)
      gates.set(guildId, pending)
    }
    return pending
  }

  const eligible = async (guildId: string, userIds: string[]): Promise<string[] | null> => {
    const gate = await gateFor(guildId)
    if (!gate?.enabled) return null
    const ids = [...new Set(userIds)]
    if (ids.length === 0) return []

    const approved = await filterApproved(env.DB, guildId, ids)
    const missing = ids.filter(id => !approved.includes(id))
    if (missing.length === 0) return approved
    // Admins count as eligible here too, so the periodic sweep does not remove
    // the people who were just told they may stay — unless they were revoked.
    const [admins, revoked] = await Promise.all([
      filterAdmins(env.DB, guildId, missing),
      filterRevoked(env.DB, guildId, missing),
    ])
    return [...approved, ...admins.filter(id => !revoked.includes(id))]
  }

  return {
    eligible,
    async require(guildId, userId) {
      const result = await eligible(guildId, [userId])
      if (result === null || result.includes(userId)) return
      // Say why, when the reason is that the exemption was withdrawn rather
      // than never having applied.
      const [admins, revoked] = await Promise.all([
        filterAdmins(env.DB, guildId, [userId]),
        filterRevoked(env.DB, guildId, [userId]),
      ])
      if (admins.length > 0 && revoked.length > 0) {
        throw new RulesAccessError(
          'Your approval was revoked, so being an admin no longer gets you in —'
          + ' take the rules check again with /party rules quiz.',
        )
      }
      throw new RulesAccessError()
    },
  }
}

/**
 * Whether this member is only getting in because they are an admin — true when
 * the party asked for the check, the guild has one, they have not passed it,
 * and they are on the admin list. The reply paths use it to warn them rather
 * than refuse them.
 *
 * `partyRequiresRules` is not optional on purpose: without it a call site can
 * quietly warn someone who joined a party that never asked for a check.
 */
export async function exemptFromRules(
  env: AppBindings, guildId: string, userId: string, partyRequiresRules: boolean,
): Promise<boolean> {
  if (!partyRequiresRules) return false
  const gate = await getRulesGate(env.DB, guildId)
  if (!gate?.enabled) return false
  if ((await filterApproved(env.DB, guildId, [userId])).length > 0) return false
  if ((await filterRevoked(env.DB, guildId, [userId])).length > 0) return false
  return (await filterAdmins(env.DB, guildId, [userId])).length > 0
}

/** The warning an exempt admin sees in place of being refused. */
export const RULES_EXEMPT_WARNING =
  "\n\n⚠️ You haven't passed this server's rules check — you were let in because you're an admin."
  + ' Everyone else is refused, so please take it when you can: `/party rules quiz`.'

export function rulesErrorMessage(error: unknown): string | null {
  return error instanceof RulesAccessError ? error.message : null
}
