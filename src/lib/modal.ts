/**
 * Raw modal JSON building and submit parsing for /party edit.
 *
 * Discord modals now accept selects in addition to text inputs (Components V2),
 * but discord-hono's typed Modal builder only supports TextInput and its
 * ModalContext extractor only reads `value` (not `values`). This module is the
 * one place that talks to the raw Discord component shapes so the rest of the
 * codebase doesn't have to.
 */

import type { PartyData } from '../types'
import { GAMES } from './games'

const EDIT_MODAL_PREFIX = 'party_edit'

export interface EditFields {
  name: string
  description: string
  capacity: string         // raw string; caller parses
  game: string
  voiceChannelId: string
}

export function buildEditModalJSON(party: PartyData): any {
  return {
    custom_id: `${EDIT_MODAL_PREFIX};${party.id}`,
    title: 'Edit party',
    components: [
      label('Name', {
        type: 4,
        custom_id: 'name',
        style: 1,
        value: party.name,
        required: true,
        max_length: 100,
      }),
      label('Description', {
        type: 4,
        custom_id: 'description',
        style: 2,
        value: party.description || '',
        required: false,
        max_length: 1000,
      }),
      label('Player cap (2–50)', {
        type: 4,
        custom_id: 'capacity',
        style: 1,
        value: String(party.maxSize),
        required: true,
        min_length: 1,
        max_length: 2,
      }),
      label('Game', {
        type: 3,
        custom_id: 'game',
        options: GAMES.map(g => ({ label: g.name, value: g.value, default: g.value === party.game })),
        min_values: 1,
        max_values: 1,
      }),
      label('Voice channel', {
        type: 8,
        custom_id: 'voice-channel',
        channel_types: [2],
        min_values: 1,
        max_values: 1,
        ...(party.voiceChannelId
          ? { default_values: [{ id: party.voiceChannelId, type: 'channel' }] }
          : {}),
      }),
    ],
  }
}

function label(text: string, component: any) {
  return { type: 18, label: text, component }
}

export function parseEditModalSubmit(interaction: any): EditFields {
  const flat: Record<string, any> = {}
  const components: any[] = interaction.data?.components ?? []
  for (const c of components) collect(c, flat)
  return {
    name: (flat['name'] ?? '').toString(),
    description: (flat['description'] ?? '').toString(),
    capacity: (flat['capacity'] ?? '').toString(),
    game: (flat['game'] ?? '').toString(),
    voiceChannelId: (flat['voice-channel'] ?? '').toString(),
  }
}

function collect(c: any, out: Record<string, any>): void {
  if (!c) return
  switch (c.type) {
    case 1:                                                 // action row
      for (const inner of c.components ?? []) collect(inner, out)
      return
    case 18:                                                // label wrapper
      if (c.component) collect(c.component, out)
      return
    case 4:                                                 // text input
      if (c.custom_id) out[c.custom_id] = c.value ?? ''
      return
    case 3: case 5: case 6: case 7: case 8:                 // selects
      if (c.custom_id) out[c.custom_id] = c.values?.[0] ?? ''
      return
  }
}

export { EDIT_MODAL_PREFIX }
