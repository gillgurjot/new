// Per-device player preferences kept in localStorage (best effort).
export interface PlayerPrefs {
  quality: string // 'auto' | '2160' | '1080' | '720' | '480' | '360'
  volume: number
  muted: boolean
  subtitleSize: 'small' | 'medium' | 'large'
  subtitleBackground: boolean
  autoplayNext: boolean
  skipIntro: boolean
  skipCredits: boolean
}

const KEY = 'lumen.player'
const defaults: PlayerPrefs = { quality: 'auto', volume: 1, muted: false, subtitleSize: 'medium', subtitleBackground: false, autoplayNext: true, skipIntro: false, skipCredits: false }

export function loadPrefs(): PlayerPrefs {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return defaults
  }
}

export function savePrefs(p: Partial<PlayerPrefs>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...p }))
  } catch {
    /* storage unavailable */
  }
}

export const qualityOptions: { value: string; label: string; height: number; kbps: number }[] = [
  { value: 'auto', label: 'Auto (best for this device)', height: 0, kbps: 0 },
  { value: '2160', label: '4K · 24 Mbps', height: 2160, kbps: 24000 },
  { value: '1080', label: '1080p · 8 Mbps', height: 1080, kbps: 8000 },
  { value: '720', label: '720p · 4 Mbps', height: 720, kbps: 4000 },
  { value: '480', label: '480p · 1.5 Mbps', height: 480, kbps: 1600 },
  { value: '360', label: '360p · 0.8 Mbps', height: 360, kbps: 900 },
]
