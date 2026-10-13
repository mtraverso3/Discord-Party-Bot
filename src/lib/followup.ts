// discord-hono's followup hands back Discord's response without looking at it,
// so a rejected reply (rate limit, expired token, bad payload) vanished without
// a trace and the user was left on "thinking…". Every deferred handler routes
// its replies through here: short rate limits get one retry, and anything that
// still fails is logged with the status and Discord's error body.

const MAX_RETRY_WAIT_MS = 5000

type Followup = (data?: any, file?: any, retry?: number) => Promise<Response>

/** Wraps `c.followup` in place; call it first thing inside a resDefer handler. */
export function checkFollowups<C extends { followup: Followup }>(c: C, label: string): C {
  const send = c.followup
  c.followup = async (...args) => {
    let res = await send(...args)
    if (!(res instanceof Response)) return res // test doubles hand back the payload
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) * 1000
      if (Number.isFinite(wait) && wait >= 0 && wait <= MAX_RETRY_WAIT_MS) {
        console.warn({ message: 'Discord followup rate-limited, retrying', label, waitMs: wait })
        await new Promise(resolve => setTimeout(resolve, wait))
        res = await send(...args)
      }
    }
    if (!res.ok) {
      const body = await res.clone().text().catch(() => '')
      console.error({ message: 'Discord followup failed', label, status: res.status, body: body.slice(0, 500) })
    }
    return res
  }
  return c
}
