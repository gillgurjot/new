// Same palette as the web app.
export const c = {
  bg: '#09090d',
  surface: '#111116',
  surface2: '#18181f',
  surface3: '#212129',
  line: 'rgba(255,255,255,0.08)',
  fg: '#f4f4f6',
  muted: '#8f8f9d',
  dim: 'rgba(255,255,255,0.6)',
  accent: '#9d8cff',
  accentStrong: '#7c66ff',
  accent2: '#f0a3d8',
  danger: '#f87171',
  success: '#34d399',
  warn: '#fbbf24',
  info: '#38bdf8',
  white: '#ffffff',
  black: '#000000',
}

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 }
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }
export const font = {
  h1: { fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.6, color: c.fg },
  h2: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.3, color: c.fg },
  h3: { fontSize: 17, fontWeight: '700' as const, color: c.fg },
  body: { fontSize: 15, color: c.fg },
  small: { fontSize: 13, color: c.muted },
  tiny: { fontSize: 11, color: c.muted },
}
