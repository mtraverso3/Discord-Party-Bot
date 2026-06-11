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
