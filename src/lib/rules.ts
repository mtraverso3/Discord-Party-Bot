import type { AppBindings } from '../types'
import { filterApproved, getRulesGate } from '../store/rules'

// Whether a member may be admitted to a party. Approval used to mean holding a
// Discord role granted by a separate bot, which meant a Discord API call per
// member on every check. It is now a row in this Worker's own database, so a
// check is one indexed query and cannot be wrong because Discord was slow.

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
    return filterApproved(env.DB, guildId, ids)
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
