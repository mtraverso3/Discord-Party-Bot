// League Client (LCU) discovery and HTTP transport.
//
// The LCU listens on https://127.0.0.1:<port> with a self-signed certificate
// and basic auth (riot:<token>); both values appear on the LeagueClientUx
// process command line, so no lockfile access or install-path guessing is
// needed.

import { execFile } from 'node:child_process'
import https from 'node:https'

export interface LcuCreds {
  port: number
  token: string
}

export interface LcuResponse {
  status: number
  body: any
}

function execText(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : String(stdout))
    })
  })
}

export async function discoverLcu(): Promise<LcuCreds | null> {
  const text = process.platform === 'win32'
    ? await execText('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine",
      ])
    : await execText('ps', ['-A', '-o', 'args=']) // macOS/Linux dev convenience

  for (const line of text.split('\n')) {
    if (!line.includes('LeagueClientUx')) continue
    const port = line.match(/--app-port=["']?(\d+)/)?.[1]
    const token = line.match(/--remoting-auth-token=["']?([\w-]+)/)?.[1]
    if (port && token) return { port: Number(port), token }
  }
  return null
}

/** Riot Client's short region code (e.g. "NA", "EUW") for the logged-in account, or null. */
export async function fetchRegion(creds: LcuCreds): Promise<string | null> {
  try {
    const res = await lcuRequest(creds, 'GET', '/riotclient/region-locale')
    const region = res.body?.region
    return res.status === 200 && typeof region === 'string' ? region.toUpperCase() : null
  } catch {
    return null
  }
}

/**
 * Raw friend-list entries from the chat plugin. Shape isn't nailed down yet —
 * this is deliberately typed loosely so the renderer can display whatever
 * fields Riot actually sends until we've confirmed which one signals a
 * joinable lobby.
 */
export async function fetchFriends(creds: LcuCreds): Promise<unknown[]> {
  try {
    const res = await lcuRequest(creds, 'GET', '/lol-chat/v1/friends')
    return res.status === 200 && Array.isArray(res.body) ? res.body : []
  } catch {
    return []
  }
}

/** A champion keyed by the player's puuid. championId 0 means "none". */
export interface ChampSelectPick {
  puuid: string
  championId: number
}

export interface ChampSelectData {
  picks: ChampSelectPick[]   // hovered/locked champions, both teams
  bannedIds: number[]        // champion ids revealed as banned so far, both teams
  banPhaseDone: boolean      // true once every ban in the draft has been revealed
}

/** Champion ids out of one of the `bans.myTeamBans`-style arrays. The client
 *  has sent these as bare ids and as `{ championId }` objects depending on the
 *  version, and pads them with 0/-1 for bans not revealed yet. */
function collectBanIds(raw: unknown, into: Set<number>): void {
  if (!Array.isArray(raw)) return
  for (const entry of raw) {
    const id = Number(entry !== null && typeof entry === 'object' ? (entry as any).championId : entry)
    if (Number.isFinite(id) && id > 0) into.add(id)
  }
}

/**
 * Picks and bans out of a raw `/lol-champ-select/v1/session` body.
 *
 * Bans come back as a flat set of champion ids: the client hides who cast an
 * enemy ban, and the inhouse assigns each member a distinct champion, so
 * "was this champion banned at all" is the only thing worth reading here.
 */
export function parseChampSelect(body: any): ChampSelectData {
  const picks: ChampSelectPick[] = []
  for (const team of [body?.myTeam, body?.theirTeam]) {
    if (!Array.isArray(team)) continue
    for (const cell of team) {
      const puuid: unknown = cell?.puuid
      // An unlocked cell reports championId 0 and carries the hover in
      // championPickIntent, so fall through on 0 rather than only on nullish.
      const locked = Number(cell?.championId ?? 0)
      const intent = Number(cell?.championPickIntent ?? 0)
      const pick = Number.isFinite(locked) && locked > 0 ? locked : intent
      if (typeof puuid === 'string' && puuid && Number.isFinite(pick) && pick > 0) {
        picks.push({ puuid, championId: pick })
      }
    }
  }

  // Bans arrive by two routes and neither is complete on its own. `actions`
  // carries each ban as it's cast, but now that both teams ban simultaneously
  // the client withholds the enemy's picks there — those actions complete with
  // championId 0 and the real ids only ever show up in `bans.theirTeamBans`
  // at the reveal. Union both, so a champion counts however it was revealed.
  const banned = new Set<number>()
  let banActions = 0
  let bansPending = 0
  if (Array.isArray(body?.actions)) {
    for (const phase of body.actions) {
      if (!Array.isArray(phase)) continue
      for (const a of phase) {
        if (a?.type !== 'ban') continue
        banActions++
        // An incomplete ban's championId is the caster's hover, not a ban yet.
        if (!a?.completed) { bansPending++; continue }
        const championId = Number(a?.championId ?? 0)
        if (championId > 0) banned.add(championId)
      }
    }
  }
  collectBanIds(body?.bans?.myTeamBans, banned)
  collectBanIds(body?.bans?.theirTeamBans, banned)

  // Completion normally comes from the actions. Should a future client stop
  // exposing ban actions entirely, fall back to the draft's declared ban count
  // so the phase can't hang as permanently in-progress.
  const numBans = Number(body?.bans?.numBans ?? 0)
  const banPhaseDone = banActions > 0
    ? bansPending === 0
    : numBans > 0 && banned.size >= numBans

  return { picks, bannedIds: [...banned], banPhaseDone }
}

/**
 * Picks and bans from the local champ-select session. Works for every lobby
 * type (customs included, unlike the Spectator API) and updates live as players
 * hover/lock/ban. Empty when not in champ select.
 */
export async function fetchChampSelect(creds: LcuCreds): Promise<ChampSelectData> {
  const empty: ChampSelectData = { picks: [], bannedIds: [], banPhaseDone: false }
  try {
    const res = await lcuRequest(creds, 'GET', '/lol-champ-select/v1/session')
    if (res.status !== 200) return empty
    return parseChampSelect(res.body)
  } catch {
    return empty
  }
}

/** The current gameflow phase (e.g. "ChampSelect", "InProgress"), or "" if unknown. */
export async function fetchGameflowPhase(creds: LcuCreds): Promise<string> {
  try {
    const res = await lcuRequest(creds, 'GET', '/lol-gameflow/v1/gameflow-phase')
    return res.status === 200 && typeof res.body === 'string' ? res.body : ''
  } catch {
    return ''
  }
}

/**
 * The numeric gameId of the game currently in progress, or 0 when there isn't
 * one. It's populated on `gameData.gameId` once the match starts (0 in lobby /
 * champ select), which is what pairs with the region to form a Match-v5 id.
 */
export async function fetchGameId(creds: LcuCreds): Promise<number> {
  try {
    const res = await lcuRequest(creds, 'GET', '/lol-gameflow/v1/session')
    const id = Number(res.body?.gameData?.gameId ?? 0)
    return res.status === 200 && Number.isFinite(id) ? id : 0
  } catch {
    return 0
  }
}

export function lcuRequest(
  creds: LcuCreds,
  method: string,
  path: string,
  body?: unknown,
): Promise<LcuResponse> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = https.request(
      {
        host: '127.0.0.1',
        port: creds.port,
        method,
        path,
        // The LCU's certificate is self-signed; the connection never leaves
        // the machine.
        rejectUnauthorized: false,
        timeout: 10_000,
        headers: {
          Authorization: 'Basic ' + Buffer.from(`riot:${creds.token}`).toString('base64'),
          Accept: 'application/json',
          ...(payload !== undefined
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { data += c })
        res.on('end', () => {
          let parsed: any = null
          try { parsed = data ? JSON.parse(data) : null } catch { /* non-JSON body */ }
          resolve({ status: res.statusCode ?? 0, body: parsed })
        })
      },
    )
    req.on('timeout', () => req.destroy(new Error('LCU request timed out')))
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}
