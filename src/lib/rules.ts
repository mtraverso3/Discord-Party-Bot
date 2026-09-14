import type { AppBindings } from '../types'
import { filterApproved, filterRevoked, getRulesGate } from '../store/rules'
import { filterAdmins } from '../store/adminAuth'

// Whether a member may be admitted to a party. Approval used to mean holding a
// Discord role granted by a separate bot, which meant a Discord API call per
// member on every check. It is now a row in this Worker's own database, so a
// check is one indexed query and cannot be wrong because Discord was slow.
//
// Admins are let through without passing. That is a deliberate hole: the people
// who run the server should not be locked out of their own queue by a check
// they are responsible for maintaining. They are warned every time instead —
// see exemptFromRules, which the reply paths use to add that warning.
//
// The exemption covers not having taken the check. It does not cover having had
// approval taken away: a revoked admin takes the quiz like anyone else, or the
// revocation would mean nothing for the people most able to ignore it. A
// moderator who wants to undo one without making them sit it uses "require
// retake without penalty", which clears the mark.
//
// The exemption also follows the person being admitted, not whoever is acting.
// An admin adding an unapproved member is still refused; otherwise "admins are
// exempt" would quietly mean "admins can admit anyone".

export class RulesAccessError extends Error {
  constructor(message = 'Complete the rules check in the rules channel before joining or being selected.') {
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
          + ' take the rules check again in the rules channel.',
        )
      }
      throw new RulesAccessError()
    },
  }
}

/**
 * Whether this member is only getting in because they are an admin — true when
 * the guild gates parties, they have not passed the check, and they are on the
 * admin list. The reply paths use it to warn them rather than refuse them.
 */
export async function exemptFromRules(
  env: AppBindings, guildId: string, userId: string,
): Promise<boolean> {
  const gate = await getRulesGate(env.DB, guildId)
  if (!gate?.enabled) return false
  if ((await filterApproved(env.DB, guildId, [userId])).length > 0) return false
  if ((await filterRevoked(env.DB, guildId, [userId])).length > 0) return false
  return (await filterAdmins(env.DB, guildId, [userId])).length > 0
}

/** The warning an exempt admin sees in place of being refused. */
export const RULES_EXEMPT_WARNING =
  "\n\n⚠️ You haven't passed this server's rules check — you were let in because you're an admin."
  + ' Members without it are refused, so please take it when you can.'

export function rulesErrorMessage(error: unknown): string | null {
  return error instanceof RulesAccessError ? error.message : null
}
