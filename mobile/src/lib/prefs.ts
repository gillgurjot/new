import { useSyncExternalStore } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

// Per-device settings (the server keeps language preferences per account).
export interface Prefs {
  quality: string // 'auto' | '2160' | '1080' | '720' | '480' | '360'
  cellularQuality: string
  subtitleSize: 'small' | 'medium' | 'large'
  subtitleBackground: boolean
  autoplayNext: boolean
  skipIntro: boolean
  skipCredits: boolean
  downloadOnWifiOnly: boolean
}

const KEY = 'lumen.prefs'
const defaults: Prefs = {
  quality: 'auto',
  cellularQuality: 'auto',
  subtitleSize: 'medium',
  subtitleBackground: true,
  autoplayNext: true,
  skipIntro: false,
  skipCredits: false,
  downloadOnWifiOnly: true,
}

let current: Prefs = defaults
const subs = new Set<() => void>()

export async function loadPrefs() {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (raw) current = { ...defaults, ...JSON.parse(raw) }
  } catch {
    /* defaults */
  }
  subs.forEach((f) => f())
  return current
}

export const getPrefs = () => current

export function setPrefs(p: Partial<Prefs>) {
  current = { ...current, ...p }
  AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => {})
  subs.forEach((f) => f())
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => current,
  )
}

export const qualityOptions: { value: string; label: string; height: number; kbps: number }[] = [
  { value: 'auto', label: 'Original (best)', height: 0, kbps: 0 },
  { value: '2160', label: '4K · 24 Mbps', height: 2160, kbps: 24000 },
  { value: '1080', label: '1080p · 8 Mbps', height: 1080, kbps: 8000 },
  { value: '720', label: '720p · 4 Mbps', height: 720, kbps: 4000 },
  { value: '480', label: '480p · 1.5 Mbps', height: 480, kbps: 1600 },
  { value: '360', label: '360p · 0.8 Mbps', height: 360, kbps: 900 },
]
