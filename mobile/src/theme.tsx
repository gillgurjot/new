import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AppState, StyleSheet, useColorScheme } from 'react-native'
import { createMaterial3Theme, getMaterial3Theme, type Material3Scheme } from '@pchmn/expo-material3-theme'
import * as SystemUI from 'expo-system-ui'
import { usePrefs } from './lib/prefs'

// Material 3 Expressive, like Inkwell: colours come from the wallpaper (Material You)
// or a seed colour, in light or dark. The player always uses the dark scheme.

export const SEED_COLORS = ['#7C66FF', '#3A5BA9', '#006A6A', '#386A20', '#8B5000', '#B3261E', '#7D5260', '#5B5D72']
export const FONT = 'GoogleSans'

export interface Palette {
  dark: boolean
  bg: string
  surface: string // container low: cards, rows
  surface2: string // container: inputs, chips
  surface3: string // container high: sheets, menus
  surface4: string // container highest
  line: string
  outline: string
  fg: string
  muted: string
  dim: string
  faint: string // tonal fill for icon buttons on any surface
  accent: string
  onAccent: string
  accentContainer: string
  onAccentContainer: string
  secondary: string
  secondaryContainer: string
  onSecondaryContainer: string
  tertiary: string
  tertiaryContainer: string
  onTertiaryContainer: string
  danger: string
  dangerContainer: string
  onDangerContainer: string
  inverse: string
  onInverse: string
  inverseAccent: string
  success: string
  warn: string
  info: string
  white: string
  black: string
  scrim: string
}

/** Colour with alpha: works on #rrggbb and rgb()/rgba() strings. */
export function alpha(color: string, a: number) {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color + Math.round(a * 255).toString(16).padStart(2, '0')
  const m = color.match(/^rgba?\(([^,]+),([^,]+),([^,)]+)/)
  return m ? `rgba(${m[1].trim()},${m[2].trim()},${m[3].trim()},${a})` : color
}

function palette(s: Material3Scheme, dark: boolean): Palette {
  return {
    dark,
    bg: s.surface,
    surface: s.surfaceContainerLow || s.elevation.level1,
    surface2: s.surfaceContainer || s.elevation.level2,
    surface3: s.surfaceContainerHigh || s.elevation.level3,
    surface4: s.surfaceContainerHighest || s.surfaceVariant,
    line: s.outlineVariant,
    outline: s.outline,
    fg: s.onSurface,
    muted: s.onSurfaceVariant,
    dim: alpha(s.onSurface, 0.78),
    faint: alpha(s.onSurface, dark ? 0.1 : 0.08),
    accent: s.primary,
    onAccent: s.onPrimary,
    accentContainer: s.primaryContainer,
    onAccentContainer: s.onPrimaryContainer,
    secondary: s.secondary,
    secondaryContainer: s.secondaryContainer,
    onSecondaryContainer: s.onSecondaryContainer,
    tertiary: s.tertiary,
    tertiaryContainer: s.tertiaryContainer,
    onTertiaryContainer: s.onTertiaryContainer,
    danger: s.error,
    dangerContainer: s.errorContainer,
    onDangerContainer: s.onErrorContainer,
    inverse: s.inverseSurface,
    onInverse: s.inverseOnSurface,
    inverseAccent: s.inversePrimary,
    success: dark ? '#7fdb9a' : '#1b6d3a',
    warn: dark ? '#f5c46b' : '#7a5900',
    info: dark ? '#8ecfff' : '#00629d',
    white: '#ffffff',
    black: '#000000',
    scrim: 'rgba(0,0,0,0.5)',
  }
}

const weight = { regular: '400', medium: '500', bold: '600', heavy: '700' } as const

function fonts(c: Palette) {
  const t = (fontSize: number, lineHeight: number, fontWeight: (typeof weight)[keyof typeof weight], color = c.fg, letterSpacing = 0) => ({ fontFamily: FONT, fontSize, lineHeight, fontWeight, color, letterSpacing })
  return {
    // Expressive "emphasized" display and headline styles.
    display: t(36, 44, weight.bold, c.fg, -0.4),
    h1: t(28, 36, weight.bold, c.fg, -0.2),
    h2: t(22, 28, weight.bold),
    h3: t(16, 22, weight.bold, c.fg, 0.1),
    title: t(18, 24, weight.medium),
    body: t(15, 22, weight.regular),
    bodyStrong: t(15, 22, weight.medium),
    small: t(13.5, 19, weight.regular, c.muted),
    tiny: t(12, 16, weight.regular, c.muted),
    label: t(14, 20, weight.medium),
    labelSmall: t(12, 16, weight.medium, c.muted, 0.3),
  }
}
export type Fonts = ReturnType<typeof fonts>

interface Theme {
  c: Palette
  f: Fonts
  /** Always-dark colours for the player and anything over video. */
  pc: Palette
  pf: Fonts
}

const fallback = createMaterial3Theme(SEED_COLORS[0])
const initial = (() => {
  const c = palette(fallback.dark, true)
  return { c, f: fonts(c), pc: c, pf: fonts(c) }
})()
const Ctx = createContext<Theme>(initial)

export const useTheme = () => useContext(Ctx)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const prefs = usePrefs()
  const system = useColorScheme()
  const dark = prefs.themeMode === 'system' ? system !== 'light' : prefs.themeMode === 'dark'
  const make = () => {
    try {
      return prefs.dynamicColor ? getMaterial3Theme(prefs.seedColor) : createMaterial3Theme(prefs.seedColor)
    } catch {
      return createMaterial3Theme(prefs.seedColor)
    }
  }
  const [m3, setM3] = useState(make)
  useEffect(() => {
    const refresh = () => {
      const next = make()
      setM3((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
    }
    refresh()
    // A new wallpaper changes the dynamic colours while we're in the background.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && prefs.dynamicColor && refresh())
    return () => sub.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.dynamicColor, prefs.seedColor])

  const theme = useMemo<Theme>(() => {
    const pc = palette(m3.dark, true)
    const c = dark ? pc : palette(m3.light, false)
    return { c, f: fonts(c), pc, pf: fonts(pc) }
  }, [m3, dark])

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.c.bg).catch(() => {})
  }, [theme.c.bg])

  return <Ctx.Provider value={theme}>{children}</Ctx.Provider>
}

/** Everything inside uses the dark scheme: the player and anything over video. */
export function DarkScope({ children }: { children: ReactNode }) {
  const t = useTheme()
  const value = useMemo(() => ({ ...t, c: t.pc, f: t.pf }), [t])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * Styles that depend on the theme: `const useStyles = makeStyles((c, f) => ({...}))`, then
 * `const s = useStyles()` in the component. Each palette is turned into a StyleSheet once.
 */
type Styles = Parameters<typeof StyleSheet.create>[0]

export function makeStyles<T extends Styles>(fn: (c: Palette, f: Fonts) => T & Styles, player = false) {
  const cache = new WeakMap<Palette, Readonly<T>>()
  return () => {
    const t = useTheme()
    const c = player ? t.pc : t.c
    let s = cache.get(c)
    if (!s) {
      s = StyleSheet.create<T>(fn(c, player ? t.pf : t.f))
      cache.set(c, s)
    }
    return s
  }
}

export const radius = { xs: 4, sm: 8, md: 12, lg: 16, xl: 28, pill: 999 }
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }
