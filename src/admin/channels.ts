import type { AppBindings } from '../types'
import { getGuildChannels } from '../lib/discord'

const VOICE_TYPES = [2, 13]  // voice, stage

export type ChannelCheck = { ok: true } | { ok: false; error: string; status: number }

/**
 * Whether each channel belongs to `guildId`. The bot sits in many guilds, so
 * an admin scoped to one must not be able to point it at another's channels.
 * Empty IDs are skipped.
 */
export async function checkGuildChannels(
  env: AppBindings, guildId: string, wanted: Array<{ id?: string; kind: 'text' | 'voice' }>,
): Promise<ChannelCheck> {
  const checks = wanted.filter(w => w.id)
  if (checks.length === 0) return { ok: true }

  let channels: Array<{ id: string; type: number }>
  try {
    channels = await getGuildChannels(env.DISCORD_BOT_TOKEN, guildId)
  } catch (e) {
    console.warn(`channel check failed for guild ${guildId}:`, e)
    return { ok: false, error: "Couldn't check that channel with Discord. Try again.", status: 502 }
  }
  for (const { id, kind } of checks) {
    const channel = channels.find(c => c.id === id)
    if (!channel) return { ok: false, error: 'That channel is not in this server.', status: 400 }
    if (kind === 'voice' && !VOICE_TYPES.includes(channel.type)) {
      return { ok: false, error: 'That is not a voice channel.', status: 400 }
    }
  }
  return { ok: true }
}
