import { useEffect, useState } from 'react'

// Names, icons and hover text for the champion, item and augment ids stored
// with each game. Items and the Data Dragon version come from Data Dragon;
// augments aren't in Data Dragon, so their names and icons come from
// CommunityDragon's Arena ("cherry") data. Both allow cross-origin reads and
// are cached by the browser. Augment descriptions need the game's 32 MB string
// table, so the Worker boils them down on a cron (src/lib/augment-text.ts).

const DDRAGON = 'https://ddragon.leagueoflegends.com'
const CDRAGON = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default'
const AUGMENT_TEXT = '/admin/api/lol/augment-text'

export type AugmentRarity = 'silver' | 'gold' | 'prismatic' | 'other'

export interface LoadoutAsset {
  name: string
  iconUrl: string
  description?: string  // League tooltip markup
}

export interface LoadoutCatalog {
  version: string | null  // Data Dragon version, for champion icons
  items: Record<number, LoadoutAsset>
  augments: Record<number, LoadoutAsset & { rarity: AugmentRarity }>
}

const RARITIES: Record<string, AugmentRarity> = { kSilver: 'silver', kGold: 'gold', kPrismatic: 'prismatic' }

/** CommunityDragon serves `/lol-game-data/assets/<path>` lowercased under its plugin root. */
function cdragonAsset(path: string): string {
  return `${CDRAGON}/${path.replace(/^\/lol-game-data\/assets\//i, '').toLowerCase()}`
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.json() as Promise<T>
}

async function loadItems(): Promise<Pick<LoadoutCatalog, 'version' | 'items'>> {
  const [version = null] = await getJson<string[]>(`${DDRAGON}/api/versions.json`)
  if (!version) return { version: null, items: {} }
  const { data } = await getJson<{ data: Record<string, { name: string; description: string; image: { full: string } }> }>(
    `${DDRAGON}/cdn/${version}/data/en_US/item.json`,
  ).catch(() => ({ data: {} as Record<string, never> }))
  const items: LoadoutCatalog['items'] = {}
  for (const [id, item] of Object.entries(data)) {
    items[Number(id)] = {
      name: item.name,
      iconUrl: `${DDRAGON}/cdn/${version}/img/item/${item.image.full}`,
      description: item.description,
    }
  }
  return { version, items }
}

async function loadAugments(): Promise<LoadoutCatalog['augments']> {
  const [list, text] = await Promise.all([
    getJson<{ id: number; nameTRA: string; augmentSmallIconPath: string; rarity: string }[]>(
      `${CDRAGON}/v1/cherry-augments.json`,
    ),
    getJson<Record<string, string>>(AUGMENT_TEXT).catch(() => ({} as Record<string, string>)),
  ])
  const augments: LoadoutCatalog['augments'] = {}
  for (const a of list) {
    augments[a.id] = {
      name: a.nameTRA,
      iconUrl: cdragonAsset(a.augmentSmallIconPath),
      rarity: RARITIES[a.rarity] ?? 'other',
      description: text[a.id],
    }
  }
  return augments
}

let pending: Promise<LoadoutCatalog> | null = null

/** Loaded once per page; any part failing just leaves those ids unnamed. */
function loadCatalog(): Promise<LoadoutCatalog> {
  pending ??= Promise.all([
    loadItems().catch(() => ({ version: null, items: {} })),
    loadAugments().catch(() => ({})),
  ]).then(([{ version, items }, augments]) => ({ version, items, augments }))
  return pending
}

/** The catalog once it has loaded, or null while it's still on its way. */
export function useLoadoutCatalog(enabled: boolean): LoadoutCatalog | null {
  const [catalog, setCatalog] = useState<LoadoutCatalog | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    loadCatalog().then(c => { if (live) setCatalog(c) })
    return () => { live = false }
  }, [enabled])
  return catalog
}

/** Square champion portrait; Match-v5's championName is Data Dragon's champion id. */
export function championIconUrl(catalog: LoadoutCatalog | null, championName: string): string | null {
  if (!catalog?.version || !championName) return null
  return `${DDRAGON}/cdn/${catalog.version}/img/champion/${championName}.png`
}
