import { createContext, useContext, useRef, type ReactNode } from 'react'
import { api } from '../api'
import type { ChannelInfo, GuildSettings } from '../types'

/**
 * Small cross-tab cache for guild settings and channel lists so switching tabs
 * doesn't refetch them every time (each is a Discord API round-trip).
 */
interface GuildData {
  getSettings(force?: boolean): Promise<GuildSettings>
  /** Last fetched settings, if any — for synchronous consumers like form defaults. */
  peekSettings(): GuildSettings | null
  setSettings(s: GuildSettings): void
  getVoiceChannels(): Promise<ChannelInfo[]>
  getTextChannels(): Promise<ChannelInfo[]>
}

const Ctx = createContext<GuildData | null>(null)

export function useGuildData(): GuildData {
  const v = useContext(Ctx)
  if (!v) throw new Error('useGuildData outside provider')
  return v
}

export function GuildDataProvider({ children }: { children: ReactNode }) {
  const store = useRef<{
    settings: GuildSettings | null
    voice: Promise<ChannelInfo[]> | null
    text: Promise<ChannelInfo[]> | null
  }>({ settings: null, voice: null, text: null })

  const value = useRef<GuildData>({
    async getSettings(force) {
      if (!store.current.settings || force) {
        store.current.settings = await api<GuildSettings>('/settings')
      }
      return store.current.settings
    },
    peekSettings: () => store.current.settings,
    setSettings(s) { store.current.settings = s },
    getVoiceChannels() {
      if (!store.current.voice) store.current.voice = api<ChannelInfo[]>('/channels')
      return store.current.voice
    },
    getTextChannels() {
      if (!store.current.text) store.current.text = api<ChannelInfo[]>('/channels?kind=text')
      return store.current.text
    },
  })

  return <Ctx.Provider value={value.current}>{children}</Ctx.Provider>
}
