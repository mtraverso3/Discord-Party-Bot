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