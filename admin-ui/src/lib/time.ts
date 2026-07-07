import type { Party } from '../types'

const HOUR_MS = 60 * 60 * 1000

// Mirrors the Worker's auto-disband schedule so the UI can show deadlines.
export function inactivityMs(p: Party): number {
  if (p.members.length >= p.maxSize || p.queue.length > 0) return 12 * HOUR_MS
  if (p.members.length > 1) return 6 * HOUR_MS
  return 2 * HOUR_MS
}

export function deadlineOf(p: Party): number {
  return (p.lastActivityAt ?? p.createdAt) + inactivityMs(p)
}

export function relTime(ms: number): string {
  const abs = Math.abs(ms)
  const m = Math.round(abs / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return m + ' min'
  const h = Math.floor(m / 60), mm = m % 60
  if (h < 24) return mm ? h + 'h ' + mm + 'm' : h + 'h'
  const d = Math.floor(h / 24), hh = h % 24
  return hh ? d + 'd ' + hh + 'h' : d + 'd'
}

export function fmtAbs(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

export function hueOf(s: string): number {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}
