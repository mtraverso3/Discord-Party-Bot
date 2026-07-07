const params = new URLSearchParams(location.search)

/** The guild being managed, from ?guild= — null shows the guild picker. */
export const guildId = params.get('guild')

let sessionExpiredHandler: (() => void) | null = null
export function onSessionExpired(fn: () => void) {
  sessionExpiredHandler = fn
}

export async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const sep = path.includes('?') ? '&' : '?'
  const url = '/admin/api' + path + (guildId ? sep + 'guild=' + encodeURIComponent(guildId) : '')
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  const ct = res.headers.get('content-type') || ''

  // An expired Access session shows up as a redirect to the team login page,
  // or as a non-JSON 401/403 (the Worker's own JWT check, or Access itself).
  const authFailed =
    (res.redirected && res.url.includes('cloudflareaccess.com')) ||
    ((res.status === 401 || res.status === 403) && !ct.includes('json')) ||
    (res.ok && ct.includes('html'))
  if (authFailed) {
    sessionExpiredHandler?.()
    throw new Error('Session expired — reload to sign in again.')
  }

  if (!res.ok) {
    const err = ct.includes('json') ? await res.json().catch(() => ({})) : {}
    throw new Error((err as { error?: string }).error || res.statusText || 'request failed')
  }
  return (ct.includes('json') ? res.json() : null) as Promise<T>
}

export function isSnowflake(s: string): boolean {
  return /^\d{15,21}$/.test(s)
}
