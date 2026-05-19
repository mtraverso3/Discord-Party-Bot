/**
 * Modal JSON building and submit parsing for /party edit.
 *
 * Modals now accept selects in addition to text inputs (Components V2 / Labels),
 * but discord-hono's typed Modal builder and ModalContext only understand
 * action-row-wrapped Text Inputs — the constructor crashes on Labels. This
 * module is the single place that talks to the raw Discord component shapes,
 * and `src/index.ts` bypasses discord-hono's modal routing for party_edit so
 * the crash never happens.
 */

import type { PartyData } from '../types'
import { GAMES } from './games'

export const EDIT_MODAL_PREFIX = 'party_edit'

export interface EditFields {
  name: string
  description: string
  capacity: string
  game: string
  isClosed: boolean
}

export function buildEditModalJSON(party: PartyData): any {
  return {
    custom_id: `${EDIT_MODAL_PREFIX};${party.id}`,
    title: 'Edit party',
    components: [
      label('Name', {
        type: 4, custom_id: 'name', style: 1, value: party.name,
        required: true, max_length: 100,
      }),
      label('Description', {
        type: 4, custom_id: 'description', style: 2, value: party.description || '',
        required: false, max_length: 1000,
      }),
      label('Player cap (2–50)', {
        type: 4, custom_id: 'capacity', style: 1, value: String(party.maxSize),
        required: true, min_length: 1, max_length: 2,
      }),
      label('Game', {
        type: 3, custom_id: 'game',
        options: GAMES.map(g => ({ label: g.name, value: g.value, default: g.value === party.game })),
        min_values: 1, max_values: 1,
      }),
      label('Status', {
        type: 3, custom_id: 'status',
        options: [
          { label: 'Open — anyone joins directly', value: 'open', default: !party.isClosed },
          { label: 'Closed — new joiners queue up', value: 'closed', default: party.isClosed },
        ],
        min_values: 1, max_values: 1,
      }),
    ],
  }
}

function label(text: string, component: any) {
  return { type: 18, label: text, component }
}

export function parseEditModalSubmit(interaction: any): EditFields {
  const flat: Record<string, string> = {}
  for (const c of interaction.data?.components ?? []) collect(c, flat)
  return {
    name:        flat['name']        ?? '',
    description: flat['description'] ?? '',
    capacity:    flat['capacity']    ?? '',
    game:        flat['game']        ?? '',
    isClosed:    flat['status'] === 'closed',
  }
}

function collect(c: any, out: Record<string, string>): void {
  if (!c) return
  switch (c.type) {
    case 1:  for (const inner of c.components ?? []) collect(inner, out); return  // action row
    case 18: if (c.component) collect(c.component, out); return                   // label wrapper
    case 4:  if (c.custom_id) out[c.custom_id] = c.value ?? ''; return            // text input
    case 3: case 5: case 6: case 7: case 8:                                       // selects
      if (c.custom_id) out[c.custom_id] = c.values?.[0] ?? ''
      return
  }
}
