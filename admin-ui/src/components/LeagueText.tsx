import type { CSSProperties, ReactNode } from 'react'

// Renders the tooltip markup League uses in item and augment text
// (<magicDamage>, <healing>, <passive>, <br>, <font color=...>, ...) with the
// game's color coding. The text comes from Riot/CommunityDragon data, so it is
// parsed into React elements rather than injected as HTML; unknown tags just
// render their contents. Colors assume the dark tooltip background.

const TAG_CLASS: Record<string, string> = {
  attention: 'font-semibold text-white',
  b: 'font-semibold',
  titleleft: 'font-semibold', titleright: 'font-semibold',
  passive: 'font-semibold text-amber-200', active: 'font-semibold text-amber-200',
  unique: 'font-semibold text-amber-200', spellname: 'font-semibold text-amber-200',
  abilityname: 'font-semibold text-amber-200', spellpassive: 'font-semibold text-amber-200',
  spellactive: 'font-semibold text-amber-200', recast: 'text-amber-200',
  rules: 'italic text-zinc-400', flavortext: 'italic text-zinc-400',
  jadeunique: 'text-zinc-400', jaderules: 'italic text-zinc-400', jadelimit: 'text-zinc-400',
  healing: 'text-emerald-400', heal: 'text-emerald-400', health: 'text-emerald-400', scalehealth: 'text-emerald-400',
  shield: 'text-slate-300',
  magicdamage: 'text-sky-400', magic: 'text-sky-400', magicpen: 'text-sky-400',
  physicaldamage: 'text-orange-400', physical: 'text-orange-400', scalead: 'text-orange-400',
  armorpen: 'text-orange-400', scalelethality: 'text-orange-400',
  truedamage: 'font-semibold text-white',
  scaleap: 'text-violet-400',
  scalearmor: 'text-amber-400',
  scalemr: 'text-cyan-300',
  crit: 'text-red-400', scalecrit: 'text-red-400', danger: 'text-red-400',
  attackspeed: 'text-yellow-300',
  speed: 'text-teal-200', ms: 'text-teal-200',
  status: 'text-fuchsia-300',
  keyword: 'text-amber-300', keywordmajor: 'text-amber-300', keywordstealth: 'text-violet-300', stealth: 'text-violet-300',
  gold: 'text-yellow-400',
  scalemana: 'text-blue-300', energy: 'text-yellow-200',
  lifesteal: 'text-rose-300', omnivamp: 'text-rose-300',
  onhit: 'text-orange-300',
  raritylegendary: 'font-semibold text-orange-300', raritymythic: 'font-semibold text-orange-300',
  raritygeneric: 'font-semibold', prismatic: 'font-semibold text-fuchsia-300',
  ornnbonus: 'text-amber-300', buffedstat: 'text-amber-300',
}

interface Node { tag: string; style?: CSSProperties; children: (Node | string)[] }

const TAG = /<(\/?)([a-zA-Z]+)([^>]*)>/g

function parse(text: string): Node {
  const root: Node = { tag: '', children: [] }
  const stack = [root]
  let last = 0
  for (const m of text.matchAll(TAG)) {
    const top = stack[stack.length - 1]!
    if (m.index! > last) top.children.push(text.slice(last, m.index))
    last = m.index! + m[0].length
    const [, closing, rawTag = '', attrs = ''] = m
    const tag = rawTag.toLowerCase()
    if (tag === 'br') { top.children.push({ tag: 'br', children: [] }); continue }
    if (closing) {
      // Close the nearest matching tag; a stray closer is ignored.
      const at = stack.map(n => n.tag).lastIndexOf(tag)
      if (at > 0) stack.length = at
      continue
    }
    const node: Node = { tag, children: [] }
    if (tag === 'font') {
      const color = /color\s*=\s*\\?["']?(#[0-9a-f]{6})/i.exec(attrs)?.[1]
      if (color) node.style = { color }
    }
    top.children.push(node)
    stack.push(node)
  }
  if (last < text.length) stack[stack.length - 1]!.children.push(text.slice(last))
  return root
}

function render(node: Node | string, key: number): ReactNode {
  if (typeof node === 'string') return node
  if (node.tag === 'br') return <br key={key} />
  const children = node.children.map(render)
  if (node.tag === 'li') return <span key={key} className="block pl-3 -indent-3">• {children}</span>
  if (node.tag === 'stats') return <span key={key} className="block text-zinc-300">{children}</span>
  const className = TAG_CLASS[node.tag]
  if (!className && !node.style) return <span key={key}>{children}</span>
  return <span key={key} className={className} style={node.style}>{children}</span>
}

/** League tooltip markup as styled text. */
export function LeagueText({ text }: { text: string }) {
  // Item text often starts with an empty <stats></stats><br><br> block.
  const trimmed = text.replace(/^(\s*<mainText>)?\s*<stats>\s*<\/stats>(\s*<br\s*\/?>)*/i, '$1')
  return <>{parse(trimmed).children.map(render)}</>
}
