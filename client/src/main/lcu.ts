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

/** A completed ban, with everything we can use to attribute it to a player:
 *  the caster's puuid when the client exposes it (ally always, enemy in customs),
 *  and the team+position slot it came from — the fallback for enemy bans, which
 *  we resolve to a player once the game loads and reveals who's in each slot. */
export interface ChampSelectBan {
  championId: number
  puuid: string | null
  team: 'my' | 'their'  // relative to the local player
  position: string      // normalized lowercase role, or '' if unassigned
}

export interface ChampSelectData {
  picks: ChampSelectPick[]   // hovered/locked champions, both teams
  bans: ChampSelectBan[]     // every completed ban, both teams
}

function normPosition(p: unknown): string {
  return typeof p === 'string' ? p.toLowerCase().trim() : ''
}

/**
 * Picks and bans from the local champ-select session. Works for every lobby
 * type (customs included, unlike the Spectator API) and updates live as players
 * hover/lock/ban. Empty when not in champ select.
 *
 * The session only exposes ally puuids (and enemy puuids in customs), so enemy
 * bans carry their team+position slot instead — enough to attribute them once
 * the game loads in and reveals who ended up in each slot.
 */
export async function fetchChampSelect(creds: LcuCreds): Promise<ChampSelectData> {
  const empty: ChampSelectData = { picks: [], bans: [] }
  try {
    const res = await lcuRequest(creds, 'GET', '/lol-champ-select/v1/session')
    if (res.status !== 200) return empty
    const body = res.body

    const picks: ChampSelectPick[] = []
    const cellMeta = new Map<number, { team: 'my' | 'their'; position: string; puuid: string | null }>()
    for (const [team, side] of [[body?.myTeam, 'my'], [body?.theirTeam, 'their']] as const) {
      if (!Array.isArray(team)) continue
      for (const cell of team) {
        const puuid: unknown = cell?.puuid
        const hasPuuid = typeof puuid === 'string' && puuid
        if (hasPuuid) {
          const championId = Number(cell?.championId ?? cell?.championPickIntent ?? 0)
          if (Number.isFinite(championId) && championId > 0) picks.push({ puuid, championId })
        }
        if (Number.isFinite(Number(cell?.cellId))) {
          cellMeta.set(Number(cell.cellId), {
            team: side, position: normPosition(cell?.assignedPosition), puuid: hasPuuid ? puuid : null,
          })
        }
      }
    }

    const bans: ChampSelectBan[] = []
    if (Array.isArray(body?.actions)) {
      for (const phase of body.actions) {
        if (!Array.isArray(phase)) continue
        for (const a of phase) {
          if (a?.type !== 'ban' || !a?.completed) continue
          const championId = Number(a?.championId ?? 0)
          if (!(championId > 0)) continue
          const meta = cellMeta.get(Number(a?.actorCellId))
          bans.push({
            championId,
            puuid: meta?.puuid ?? null,
            team: meta?.team ?? (a?.isAllyAction ? 'my' : 'their'),
            position: meta?.position ?? '',
          })
        }
      }
    }
    return { picks, bans }
  } catch {
    return empty
  }
}

/** A player as seen in the in-game Live Client Data API (only up once loaded in). */
export interface LivePlayer {
  riotId: string    // "gameName#tagLine" (or summoner name on older clients)
  team: string      // "ORDER" | "CHAOS"
  position: string  // normalized lowercase role, or '' (e.g. ARAM)
}

/**
 * The in-game player list from the Live Client Data API (port 2999, no auth,
 * self-signed). Available only while a match is actually loaded/running; returns
 * [] otherwise. This is what reveals each player's team + position after champ
 * select, letting us attribute enemy bans we couldn't during the draft.
 */
export function fetchLiveClientPlayers(): Promise<LivePlayer[]> {
  return new Promise((resolve) => {
    const req = https.request(
      { host: '127.0.0.1', port: 2999, path: '/liveclientdata/playerlist', method: 'GET', rejectUnauthorized: false, timeout: 5000 },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { data += c })
        res.on('end', () => {
          try {
            const arr = JSON.parse(data)
            if (!Array.isArray(arr)) return resolve([])
            resolve(arr.map((p: any): LivePlayer => ({
              riotId: (typeof p?.riotId === 'string' && p.riotId) ? p.riotId : String(p?.summonerName ?? ''),
              team: String(p?.team ?? ''),
              position: normPosition(p?.position),
            })).filter((p) => p.riotId))
          } catch { resolve([]) }
        })
      },
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve([]))
    req.end()
  })
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
