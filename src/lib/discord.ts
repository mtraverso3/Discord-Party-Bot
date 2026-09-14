const BASE = 'https://discord.com/api/v10'

// Discord throttles per message and per channel, and an embed can take a burst
// of edits (joins, BRB toggles, bumps) before something important like the
// disband tombstone lands. Without this a 429 is just a failed request the
// caller logs and forgets, leaving the message stale on screen. Waits come
// from Discord's own Retry-After header and are bounded, since this runs
// inside a Worker.
const RATE_LIMIT_RETRIES = 2
const MAX_RETRY_WAIT_MS = 5000

/** Retry-After in ms, or null when it's absent or longer than we'll wait. */
function retryAfterMs(res: Response): number | null {
  const header = res.headers.get('retry-after')
  if (!header) return null
  const ms = Number(header) * 1000
  if (!Number.isFinite(ms) || ms < 0 || ms > MAX_RETRY_WAIT_MS) return null
  return ms
}

async function discordFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    // Only the header is read, so the body is still intact for the caller.
    const wait = res.status === 429 && attempt < RATE_LIMIT_RETRIES ? retryAfterMs(res) : null
    if (wait === null) return res
    console.warn(`Discord rate-limited ${path} — retrying in ${wait}ms`)
    await new Promise(resolve => setTimeout(resolve, wait))
  }
}

export async function postMessage(
  token: string,
  channelId: string,
  body: unknown,
): Promise<{ id: string; channel_id: string }> {
  const res = await discordFetch(token, `/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`postMessage failed: ${await res.text()}`)
  return res.json<{ id: string; channel_id: string }>()
}

export async function editMessage(
  token: string,
  channelId: string,
  messageId: string,
  body: unknown,
): Promise<void> {
  const res = await discordFetch(token, `/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`editMessage failed: ${await res.text()}`)
}

export async function deleteMessage(
  token: string,
  channelId: string,
  messageId: string,
): Promise<void> {
  await discordFetch(token, `/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' })
}

export interface ChannelMessage {
  id: string
  author?: { id: string; bot?: boolean }
  embeds?: Array<{ timestamp?: string; footer?: { text?: string } }>
}

/** Most recent messages in a channel, newest first. Needs READ_MESSAGE_HISTORY. */
export async function getChannelMessages(
  token: string,
  channelId: string,
  limit: number,
): Promise<ChannelMessage[]> {
  const res = await discordFetch(token, `/channels/${channelId}/messages?limit=${limit}`)
  if (!res.ok) throw new Error(`getChannelMessages failed: ${res.status}`)
  return res.json<ChannelMessage[]>()
}

// Edits the deferred response for an interaction (uses the interaction token,
// not the bot token — no auth header needed).
export async function editInteractionResponse(
  appId: string,
  interactionToken: string,
  body: unknown,
): Promise<void> {
  await fetch(`${BASE}/webhooks/${appId}/${interactionToken}/messages/@original`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Add or remove a role. A 404 on removal means it was already gone. */
export async function addRole(token: string, guildId: string, userId: string, roleId: string): Promise<void> {
  const res = await discordFetch(token, `/guilds/${guildId}/members/${userId}/roles/${roleId}`, { method: 'PUT' })
  if (!res.ok) throw new Error(`addRole failed: ${res.status} ${await res.text()}`)
}

export async function removeRole(token: string, guildId: string, userId: string, roleId: string): Promise<void> {
  const res = await discordFetch(token, `/guilds/${guildId}/members/${userId}/roles/${roleId}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw new Error(`removeRole failed: ${res.status} ${await res.text()}`)
}

export async function getGuildMember(
  token: string,
  guildId: string,
  userId: string,
): Promise<{ user: { id: string; username: string; global_name?: string; avatar?: string | null }; nick?: string; avatar?: string | null }> {
  const res = await discordFetch(token, `/guilds/${guildId}/members/${userId}`)
  if (!res.ok) throw new Error(`getGuildMember failed: ${res.status}`)
  return res.json<any>()
}

/** CDN URL for a member's avatar (guild-specific first, then their global one),
 *  or null when they use a default avatar. `.png` renders animated ones static. */
function memberAvatarUrl(
  guildId: string,
  userId: string,
  member: { user?: { avatar?: string | null }; avatar?: string | null },
): string | null {
  if (member.avatar) {
    return `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${member.avatar}.png?size=64`
  }
  if (member.user?.avatar) {
    return `https://cdn.discordapp.com/avatars/${userId}/${member.user.avatar}.png?size=64`
  }
  return null
}

const AVATAR_CACHE_TTL_SECONDS = 6 * 60 * 60

/** Resolve (and cache) a member's avatar URL. Cached for 6h via the Workers
 *  Cache API — the session polls frequently, so this keeps Discord calls to
 *  roughly one per user. A cached empty body means "resolved, but no custom
 *  avatar" (→ null). */
export async function getMemberAvatarUrl(
  token: string,
  guildId: string,
  userId: string,
): Promise<string | null> {
  const cacheKey = new Request(`https://cache.partybot.internal/avatar/${guildId}/${userId}`)
  const cache = await caches.open('avatars')
  const hit = await cache.match(cacheKey).catch(() => null)
  if (hit) return (await hit.text()) || null

  let url: string | null = null
  try {
    url = memberAvatarUrl(guildId, userId, await getGuildMember(token, guildId, userId))
  } catch { /* leave null; client falls back to initials */ }
  await cache.put(cacheKey, new Response(url ?? '', {
    headers: { 'Cache-Control': `max-age=${AVATAR_CACHE_TTL_SECONDS}` },
  })).catch(() => {})
  return url
}

// Global user lookup — works even for someone who has left the guild, so we can
// still show a username instead of a bare ID. Returns null if the ID is unknown.
export async function getUserById(
  token: string,
  userId: string,
): Promise<{ id: string; username: string; global_name?: string } | null> {
  const res = await discordFetch(token, `/users/${userId}`)
  if (!res.ok) return null
  return res.json<any>()
}

export async function searchGuildMembers(
  token: string,
  guildId: string,
  query: string,
  limit = 10,
): Promise<Array<{ user: { id: string; username: string; global_name?: string }; nick?: string }>> {
  const res = await discordFetch(
    token,
    `/guilds/${guildId}/members/search?query=${encodeURIComponent(query)}&limit=${limit}`,
  )
  if (!res.ok) throw new Error(`searchGuildMembers failed: ${res.status}`)
  return res.json<any>()
}

// Single page of up to 200 guilds — plenty for a bot at this scale.
export async function getBotGuilds(
  token: string,
): Promise<Array<{ id: string; name: string; icon: string | null }>> {
  const res = await discordFetch(token, '/users/@me/guilds')
  if (!res.ok) throw new Error(`getBotGuilds failed: ${res.status}`)
  return res.json<any>()
}

export async function getGuildChannels(
  token: string,
  guildId: string,
): Promise<Array<{ id: string; name: string; type: number }>> {
  const res = await discordFetch(token, `/guilds/${guildId}/channels`)
  if (!res.ok) throw new Error(`getGuildChannels failed: ${res.status}`)
  return res.json<any>()
}

/** The voice channel a user is currently in, or null if not in voice. */
export async function getUserVoiceChannel(
  token: string,
  guildId: string,
  userId: string,
): Promise<string | null> {
  const res = await discordFetch(token, `/guilds/${guildId}/voice-states/${userId}`)
  if (res.status === 404) return null  // not connected to voice
  if (!res.ok) throw new Error(`getUserVoiceChannel failed: ${res.status}`)
  const state = await res.json<{ channel_id?: string | null }>()
  return state.channel_id ?? null
}