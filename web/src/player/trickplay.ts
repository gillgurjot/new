import { useEffect, useState } from 'react'

export interface TrickIndex {
  interval: number
  width: number
  height: number
  cols: number
  rows: number
  count: number
  sheets: number
}

export function useTrickplay(url?: string, fileId?: number) {
  const [idx, setIdx] = useState<TrickIndex | null>(null)
  useEffect(() => {
    setIdx(null)
    if (!url) return
    let alive = true
    fetch(url, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setIdx(j))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [url])
  /** CSS for the thumbnail at time t, or null. */
  const thumb = (t: number): React.CSSProperties | null => {
    if (!idx || !fileId) return null
    const n = Math.min(Math.floor(t / idx.interval), Math.max(0, idx.count - 1))
    const per = idx.cols * idx.rows
    const sheet = Math.floor(n / per) + 1
    if (sheet > idx.sheets) return null
    const k = n % per
    const x = (k % idx.cols) * idx.width
    const y = Math.floor(k / idx.cols) * idx.height
    return {
      width: idx.width,
      height: idx.height,
      backgroundImage: `url(/api/trickplay/${fileId}/${String(sheet).padStart(3, '0')}.jpg)`,
      backgroundPosition: `-${x}px -${y}px`,
      backgroundSize: `${idx.cols * idx.width}px auto`,
    }
  }
  return { ready: !!idx, thumb, height: idx?.height ?? 0, width: idx?.width ?? 0 }
}
