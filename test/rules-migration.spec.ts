import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getRulesConfig, publishRulesConfig, saveRulesGate } from '../src/store/rules'
import { TEST_RULES } from './rules-fixture'

// 0015 copies the old built-in rules into guilds that were using them. It runs
// once at setup against an empty database, so each test seeds guilds and runs
// its SQL again.

let seq = 0
const guild = () => `mig-${++seq}`

async function migrate() {
  const migration = env.TEST_MIGRATIONS.find(m => m.name.startsWith('0015_'))!
  for (const query of migration.queries) await env.DB.prepare(query).run()
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

const SIGNALS: Record<string, (g: string) => Promise<unknown>> = {
  'a tracked member': g => env.DB.prepare(
    "INSERT INTO rules_members (guild_id, user_id, state) VALUES (?1, 'u', 'approved')").bind(g).run(),
  'a history entry': g => env.DB.prepare(
    "INSERT INTO rules_events (guild_id, user_id, kind, reason, created_at) VALUES (?1, 'u', 'verified', 'x', 0)").bind(g).run(),
  'a quiz in progress': g => env.DB.prepare(
    'INSERT INTO rules_sessions (guild_id, user_id, generation, version, updated_at) VALUES (?1, \'u\', 0, 1, 0)').bind(g).run(),
  'a posted Start button': g => saveRulesGate(env.DB, g, { channelId: '700000000000000001' }),
  'a gated party': g => env.DB.prepare(`
    INSERT INTO parties (guild_id, id, name, owner_id, max_size, rules_required, created_at, last_activity_at)
    VALUES (?1, 'P1', 'p', 'o', 5, 1, 0, 0)`).bind(g).run(),
  'a gated template': g => env.DB.prepare(`
    INSERT INTO templates (guild_id, id, label, max_size, rules_required, created_at, updated_at)
    VALUES (?1, 'T1', 't', 5, 1, 0, 0)`).bind(g).run(),
}

describe('0015_rules_per_guild', () => {
  for (const [signal, seed] of Object.entries(SIGNALS)) {
    it(`keeps the built-in rules for a guild with ${signal}`, async () => {
      const g = guild()
      await seed(g)
      await migrate()
      const config = await getRulesConfig(env.DB, g)
      expect(config.version).toBe(1)
      expect(config.pages).toHaveLength(3)
      expect(config.pages[0]!.title).toBe('Arena In-House Rules & Conduct — General Mindset')
      expect(config.questions).toHaveLength(10)
      // The exact content guilds were served before the fallback was removed.
      expect(await sha256(JSON.stringify({ p: config.pages, q: config.questions, a: config.agreement })))
        .toBe('0571a523488a9ddd15cc95f66f0486e3a76cf17353695446d705006c30efe914')
    })
  }

  it('gives nothing to a guild that only switched the gate on, or never touched it', async () => {
    const toggled = guild()
    await saveRulesGate(env.DB, toggled, { enabled: true })
    const untouched = guild()
    await migrate()
    expect((await getRulesConfig(env.DB, toggled)).pages).toEqual([])
    expect((await getRulesConfig(env.DB, untouched)).pages).toEqual([])
  })

  it('leaves a guild that already published exactly as it was', async () => {
    const g = guild()
    await publishRulesConfig(env.DB, g, TEST_RULES, 1, false, 'admin')
    await env.DB.prepare(
      "INSERT INTO rules_members (guild_id, user_id, state) VALUES (?1, 'u', 'approved')").bind(g).run()
    const before = await env.DB.prepare('SELECT * FROM rules_config WHERE guild_id = ?1').bind(g).first()
    await migrate()
    expect(await env.DB.prepare('SELECT * FROM rules_config WHERE guild_id = ?1').bind(g).first()).toEqual(before)
  })
})
