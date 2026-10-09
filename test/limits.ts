/**
 * Spend a limiter's whole budget, then keep going until the first refusal.
 * Workers rate limits count in fixed windows on the clock, so a burst that
 * crosses a minute boundary starts a fresh count: the budget is never refused
 * early, but the refusal can take up to one more budget of requests.
 */
export async function exhaust(budget: number, send: () => Promise<Response>) {
  const before: number[] = []
  for (let i = 0; i < budget; i++) before.push((await send()).status)
  for (let i = 0; i <= budget; i++) {
    const res = await send()
    if (res.status === 429) return { before, limited: res }
  }
  return { before, limited: null }
}
