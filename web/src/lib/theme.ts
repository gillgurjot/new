import { useSyncExternalStore } from 'react'

// Light, dark or follow the system, kept per device. index.html applies it before the
// first paint; this keeps it in step afterwards.
export type ThemeMode = 'system' | 'light' | 'dark'

const KEY = 'lumen.theme'
const dark = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

export function themeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* storage unavailable */
  }
  return 'dark'
}

function apply() {
  const m = themeMode()
  const t = m === 'system' ? (dark.matches ? 'dark' : 'light') : m
  document.documentElement.dataset.theme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#07080c' : '#eef0f6')
  listeners.forEach((l) => l())
}

export function setThemeMode(m: ThemeMode) {
  try {
    localStorage.setItem(KEY, m)
  } catch {
    /* storage unavailable */
  }
  apply()
}

export function useThemeMode() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    themeMode,
  )
}

dark.addEventListener('change', () => themeMode() === 'system' && apply())
apply()
