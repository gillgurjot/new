export interface Cue {
  start: number
  end: number
  text: string
}

function ts(s: string): number {
  const parts = s.trim().replace(',', '.').split(':')
  let sec = 0
  for (const p of parts) sec = sec * 60 + parseFloat(p)
  return sec
}

/** Minimal WebVTT parser: timings + text (tags stripped except <i>/<b>). */
export function parseVTT(src: string): Cue[] {
  const cues: Cue[] = []
  const blocks = src.replace(/\r/g, '').split(/\n\n+/)
  for (const b of blocks) {
    const lines = b.split('\n')
    const i = lines.findIndex((l) => l.includes('-->'))
    if (i < 0) continue
    const [a, rest] = lines[i].split('-->')
    const end = rest.trim().split(/\s+/)[0]
    const text = lines
      .slice(i + 1)
      .join('\n')
      .replace(/<(?!\/?[ib]>)[^>]+>/g, '')
      .trim()
    if (text) cues.push({ start: ts(a), end: ts(end), text })
  }
  return cues.sort((x, y) => x.start - y.start)
}

/** Active cues at time t (binary search, cues sorted by start). */
export function activeCues(cues: Cue[], t: number): Cue[] {
  let lo = 0
  let hi = cues.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].start <= t) lo = mid + 1
    else hi = mid
  }
  const out: Cue[] = []
  for (let i = lo - 1; i >= 0 && i >= lo - 8; i--) {
    if (cues[i].end > t) out.unshift(cues[i])
  }
  return out
}
