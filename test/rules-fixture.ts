import { env } from 'cloudflare:test'
import { hasPublishedRules, publishRulesConfig, saveRulesGate } from '../src/store/rules'
import type { RulesGate } from '../src/types'

export const TEST_RULES = {
  pages: [{ title: 'Rules', text: 'Be excellent.' }],
  questions: [],
  agreement: 'I agree.',
}

/** Switch the check on, publishing a minimal rule set first if the guild has none. */
export async function enableRules(guildId: string, gate: Partial<RulesGate> = {}) {
  if (!await hasPublishedRules(env.DB, guildId)) {
    const published = await publishRulesConfig(env.DB, guildId, TEST_RULES, 1, false, 'test')
    if (!published.ok) throw new Error(published.error)
  }
  return saveRulesGate(env.DB, guildId, { enabled: true, ...gate })
}
