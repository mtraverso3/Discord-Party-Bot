// Dev diagnostic: dump the raw /lol-champ-select/v1/session body to a file.
//
// Run it while sitting in champ select (ideally right after bans are revealed)
// when ban detection looks wrong — the dump shows exactly which fields the
// current client populates, so the parser can be matched to reality instead of
// guessed at. Not part of the shipped build.
//
//   node scripts/dump-champ-select.mjs [outfile]

import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import https from 'node:https'

const out = process.argv[2] ?? 'champ-select-dump.json'

const execText = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
    resolve(err ? '' : String(stdout))
  })
})

async function discover() {
  const text = process.platform === 'win32'
    ? await execText('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine",
      ])
    : await execText('ps', ['-A', '-o', 'args='])

  for (const line of text.split('\n')) {
    if (!line.includes('LeagueClientUx')) continue
    const port = line.match(/--app-port=["']?(\d+)/)?.[1]
    const token = line.match(/--remoting-auth-token=["']?([\w-]+)/)?.[1]
    if (port && token) return { port: Number(port), token }
  }
  return null
}

const get = (creds, path) => new Promise((resolve, reject) => {
  const req = https.request({
    host: '127.0.0.1', port: creds.port, method: 'GET', path,
    rejectUnauthorized: false,  // the LCU cert is self-signed; never leaves the machine
    headers: { Authorization: `Basic ${Buffer.from(`riot:${creds.token}`).toString('base64')}` },
  }, (res) => {
    let data = ''
    res.setEncoding('utf8')
    res.on('data', (c) => { data += c })
    res.on('end', () => {
      try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
      catch { resolve({ status: res.statusCode, body: data }) }
    })
  })
  req.on('error', reject)
  req.end()
})

const creds = await discover()
if (!creds) {
  console.error('League client not running (no LeagueClientUx process found).')
  process.exit(1)
}

const res = await get(creds, '/lol-champ-select/v1/session')
if (res.status !== 200) {
  console.error(`Not in champ select — session returned HTTP ${res.status}.`)
  process.exit(1)
}

writeFileSync(out, JSON.stringify(res.body, null, 2))

// Summarise the two routes bans can arrive by, which is the usual culprit.
const b = res.body?.bans ?? {}
const actionBans = (res.body?.actions ?? []).flat().filter((a) => a?.type === 'ban')
console.log(`Wrote ${out}`)
console.log(`  bans.myTeamBans    : ${JSON.stringify(b.myTeamBans)}`)
console.log(`  bans.theirTeamBans : ${JSON.stringify(b.theirTeamBans)}`)
console.log(`  bans.numBans       : ${JSON.stringify(b.numBans)}`)
console.log(`  ban actions        : ${actionBans.length} (${actionBans.filter((a) => a.completed).length} completed)`)
console.log(`  ids in actions     : ${JSON.stringify(actionBans.filter((a) => a.completed && a.championId > 0).map((a) => a.championId))}`)
