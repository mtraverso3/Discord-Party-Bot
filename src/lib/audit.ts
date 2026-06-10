/**
 * Per-guild audit log for admin actions — a KV-backed ring buffer of the most
 * recent entries. Best-effort: concurrent admin writes may race (KV has no
 * transactions), which is acceptable for an activity trail.
 */

export interface AuditEntry {
  ts: number
  email?: string
  method: string
  path: string  // admin API path including party/user IDs, e.g. "/parties/AB12CD/close"
}

const MAX_ENTRIES = 200

function key(guildId: string): string {
  return `guild:${guildId}:audit`
}

export async function appendAudit(kv: KVNamespace, guildId: string, entry: AuditEntry): Promise<void> {
  const log = await getAudit(kv, guildId)
  log.unshift(entry)
  await kv.put(key(guildId), JSON.stringify(log.slice(0, MAX_ENTRIES)))
}

export async function getAudit(kv: KVNamespace, guildId: string): Promise<AuditEntry[]> {
  const raw = await kv.get(key(guildId))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
