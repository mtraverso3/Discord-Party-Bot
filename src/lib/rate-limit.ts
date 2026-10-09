/** Seconds a limited caller is told to wait; every limiter uses a 60s window. */
const RETRY_AFTER_SECONDS = 60

/** A 429 when `limiter` is out of budget for `key`, otherwise null. Logged so hits can be found. */
export async function rateLimited(limiter: RateLimit | undefined, key: string, what: string): Promise<Response | null> {
  if (!limiter || (await limiter.limit({ key })).success) return null
  console.warn(`rate limited: ${what}`)
  return Response.json(
    { ok: false, error: 'Too many requests. Try again in a minute.' },
    { status: 429, headers: { 'Retry-After': String(RETRY_AFTER_SECONDS) } },
  )
}

export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? 'unknown'
}
