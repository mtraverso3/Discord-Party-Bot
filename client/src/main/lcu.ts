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
  picks: ChampSelectPick[]      // hovered/locked champions, both teams
  allyBans: ChampSelectPick[]   // completed bans by ally (party) players
}

/**
 * Picks and ally bans from the local champ-select session. Works for every
 * lobby type (customs included, unlike the Spectator API) and updates live as
 * players hover/lock/ban. Empty when not in champ select.
 *
 * Bans are attributed to the player who cast them via actorCellId → puuid;
 * this attribution only exists while the champ-select session is live (it's
 * gone once the game starts).
 */
export async function fetchChampSelect(creds: LcuCreds): Promise<ChampSelectData> {
  const empty: ChampSelectData = { picks: [], allyBans: [] }
  try {
    const res = await lcuRequest(creds, 'GET', '/lol-champ-select/v1/session')
    if (res.status !== 200) return empty
    const body = res.body

    const picks: ChampSelectPick[] = []
    const cellToPuuid = new Map<number, string>()
    for (const team of [body?.myTeam, body?.theirTeam]) {
      if (!Array.isArray(team)) continue
      for (const cell of team) {
        const puuid: unknown = cell?.puuid
        if (typeof puuid !== 'string' || !puuid) continue
        const championId = Number(cell?.championId ?? cell?.championPickIntent ?? 0)
        if (Number.isFinite(championId) && championId > 0) picks.push({ puuid, championId })
      }
    }
    if (Array.isArray(body?.myTeam)) {
      for (const cell of body.myTeam) {
        if (typeof cell?.puuid === 'string' && Number.isFinite(Number(cell?.cellId))) {
          cellToPuuid.set(Number(cell.cellId), cell.puuid)
        }
      }
    }

    const allyBans: ChampSelectPick[] = []
    if (Array.isArray(body?.actions)) {
      for (const phase of body.actions) {
        if (!Array.isArray(phase)) continue
        for (const a of phase) {
          if (a?.type !== 'ban' || !a?.completed || !a?.isAllyAction) continue
          const championId = Number(a?.championId ?? 0)
          const puuid = cellToPuuid.get(Number(a?.actorCellId))
          if (puuid && championId > 0) allyBans.push({ puuid, championId })
        }
      }
    }
    return { picks, allyBans }
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
