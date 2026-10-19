import type { Item } from '../api/types'

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export function formatRuntime(min?: number, seconds?: number): string {
  const m = min || (seconds ? Math.round(seconds / 60) : 0)
  if (!m) return ''
  const h = Math.floor(m / 60)
  return h ? `${h}h ${m % 60}m` : `${m}m`
}

export function episodeLabel(it: Item): string {
  if (it.seasonNumber == null || it.episodeNumber == null) return ''
  const e = `E${it.episodeNumber}${it.episodeEnd ? `–${it.episodeEnd}` : ''}`
  return it.seasonNumber === 0 ? `Special ${e}` : `S${it.seasonNumber} · ${e}`
}

export function progressPct(it: Item): number {
  const d = it.duration || (it.runtime ? it.runtime * 60 : 0)
  if (!d || !it.userData?.position) return 0
  return Math.min(100, (it.userData.position / d) * 100)
}

export function remaining(it: Item): string {
  const d = it.duration || (it.runtime ? it.runtime * 60 : 0)
  if (!d) return ''
  const left = Math.max(0, d - (it.userData?.position || 0))
  return formatRuntime(Math.round(left / 60)) + ' left'
}

export function bytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i > 1 ? 1 : 0)} ${u[i]}`
}

export function resolutionLabel(w: number, h: number): string {
  if (w >= 3200 || h >= 2000) return '4K'
  if (w >= 2200 || h >= 1300) return '1440p'
  if (w >= 1700 || h >= 1000) return '1080p'
  if (w >= 1200 || h >= 700) return '720p'
  if (h >= 560) return '576p'
  return `${h}p`
}

export function timeAgo(unix: number): string {
  if (!unix) return 'never'
  const s = Date.now() / 1000 - unix
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
