const BASE = 'https://discord.com/api/v10'

function discordFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
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

export async function getGuildMember(
  token: string,
  guildId: string,
  userId: string,
): Promise<{ user: { id: string; username: string; global_name?: string }; nick?: string }> {
  const res = await discordFetch(token, `/guilds/${guildId}/members/${userId}`)
  if (!res.ok) throw new Error(`getGuildMember failed: ${res.status}`)
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