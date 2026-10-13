import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUGMENT_TEXT_MAX_AGE_MS, buildAugmentText, readStringTable, refreshAugmentText, refreshAugmentTextIfStale,
} from '../src/lib/augment-text'
import { handleAdminApi } from '../src/admin/api'

// Augment hover text is rebuilt by the cron from CommunityDragon. The game's
// string table is ~32 MB, so it is streamed and filtered rather than parsed.

/** A stream that hands `text` over in `size`-byte chunks, so tokens straddle them. */
function chunked(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  let at = 0
  return new ReadableStream({
    pull(controller) {
      if (at >= bytes.length) { controller.close(); return }
      controller.enqueue(bytes.slice(at, at + size))
      at += size
    },
  })
}

describe('readStringTable', () => {
  const table = JSON.stringify({
    entries: {
      cherry_a_tooltip: 'Deal <magicDamage>@Dmg@ damage</magicDamage>',
      tft_skip_me: 'x'.repeat(500),
      kiwi_b_summary: 'Quote " backslash \\ newline \n unicode é ✓',
      cherry_c_summary: '',
    },
    version: '16.20',
  })
  const keep = (key: string) => /^(?:kiwi|cherry)_/.test(key)

  it.each([1, 2, 3, 7, 64, 100_000])('keeps only matching entries, decoded, with %i-byte chunks', async size => {
    expect(await readStringTable(chunked(table, size), keep)).toEqual({
      cherry_a_tooltip: 'Deal <magicDamage>@Dmg@ damage</magicDamage>',
      kiwi_b_summary: 'Quote " backslash \\ newline \n unicode é ✓',
      cherry_c_summary: '',
    })
  })
})

describe('buildAugmentText', () => {
  const catalog = [
    { id: 1, augmentNameId: 'CriticalHealing' },
    { id: 2, augmentNameId: 'ARAM_ProteinShake' },
    { id: 3, augmentNameId: 'WildFire' },
    { id: 4, augmentNameId: 'NoTextAnywhere' },
  ]
  const arena = [{
    id: 1,
    desc: 'Gain <crit>%i:scaleCrit% @CritChance*100@% Crit Chance</crit> and @Heal@ healing.<br><br>',
    dataValues: { CritChance: [0, 0.25], Heal: [0, 30] },
  }]
  const strings = {
    kiwi_proteinshake_tooltip: 'Gain <healing>@Power@% Heal Power</healing>.',
    kiwi_proteinshake_summary: 'Gain Heal Power from {{kiwi_keyword_resists}}.',
    kiwi_keyword_resists: '<scaleArmor>Armor</scaleArmor>',
    cherry_wildfire_tooltip: 'Fling a fireball every @Cooldown@s.',
  }

  it('fills in data values and strips stat icons and trailing breaks', () => {
    expect(buildAugmentText(catalog, arena, strings)[1]).toBe('Gain <crit>25% Crit Chance</crit> and 30 healing.')
  })

  it('prefers text with no unknown values, expanding references', () => {
    expect(buildAugmentText(catalog, arena, strings)[2]).toBe('Gain Heal Power from <scaleArmor>Armor</scaleArmor>.')
  })

  it('marks values it cannot work out with "?" when nothing better exists', () => {
    expect(buildAugmentText(catalog, arena, strings)[3]).toBe('Fling a fireball every ?s.')
  })

  it('leaves out augments with no text', () => {
    expect(buildAugmentText(catalog, arena, strings)).not.toHaveProperty('4')
  })
})

describe('refresh and the admin route', () => {
  const realFetch = globalThis.fetch
  let tableStatus = 200
  let catalog = [{ id: 7, augmentNameId: 'Thing' }]

  beforeEach(async () => {
    tableStatus = 200
    catalog = [{ id: 7, augmentNameId: 'Thing' }]
    await env.DB.prepare('DELETE FROM lol_data').run()
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url
      if (url.endsWith('/cherry-augments.json')) return Response.json(catalog)
      if (url.endsWith('/cdragon/arena/en_us.json')) return Response.json({ augments: [] })
      if (url.endsWith('/lol.stringtable.json')) {
        if (tableStatus !== 200) return new Response('down', { status: tableStatus })
        return new Response(JSON.stringify({ entries: { cherry_thing_summary: 'Does <keyword>things</keyword>.' } }))
      }
      return realFetch(input)
    }) as any
  })
  afterEach(() => { globalThis.fetch = realFetch })

  async function served(): Promise<Record<string, string>> {
    const url = new URL('http://x/admin/api/lol/augment-text')
    const res = await handleAdminApi(new Request(url), env, url, 'boss@example.com')
    expect(res.status).toBe(200)
    return res.json()
  }

  it('serves nothing before the first refresh, then the built text', async () => {
    expect(await served()).toEqual({})
    expect(await refreshAugmentText(env.DB)).toBe(1)
    expect(await served()).toEqual({ 7: 'Does <keyword>things</keyword>.' })
  })

  it('refreshes only when the stored text is missing or a day old', async () => {
    const now = 1_000_000_000_000
    expect(await refreshAugmentTextIfStale(env.DB, now)).toBe(1)
    expect(await refreshAugmentTextIfStale(env.DB, now + AUGMENT_TEXT_MAX_AGE_MS - 1)).toBeNull()
    expect(await refreshAugmentTextIfStale(env.DB, now + AUGMENT_TEXT_MAX_AGE_MS)).toBe(1)
  })

  it('keeps the stored text when an upstream fetch fails or yields nothing', async () => {
    await refreshAugmentText(env.DB)
    tableStatus = 503
    await expect(refreshAugmentText(env.DB)).rejects.toThrow()
    tableStatus = 200
    catalog = []
    await expect(refreshAugmentText(env.DB)).rejects.toThrow('no augment text built')
    expect(await served()).toEqual({ 7: 'Does <keyword>things</keyword>.' })
  })
})
