import { useEffect, useRef, useState } from 'react'
import { PanResponder, View } from 'react-native'
import { Image } from 'expo-image'
import { abs, api, authHeaders } from '../api/client'
import { formatTime } from '../lib/format'
import { makeStyles, useTheme } from '../theme'
import { Text } from '../components/ui'

export interface TrickIndex {
  interval: number
  width: number
  height: number
  cols: number
  rows: number
  count: number
  sheets: number
}

/** Seek-preview thumbnails made by the server (sprite sheets). */
export function useTrickplay(url?: string, fileId?: number) {
  const [idx, setIdx] = useState<TrickIndex | null>(null)
  useEffect(() => {
    setIdx(null)
    if (!url) return
    let alive = true
    api<TrickIndex>(url).then((j) => alive && setIdx(j)).catch(() => {})
    return () => {
      alive = false
    }
  }, [url])
  return { idx, fileId }
}

function Thumb({ t, trick }: { t: number; trick: ReturnType<typeof useTrickplay> }) {
  const { idx, fileId } = trick
  const { pc: c } = useTheme()
  if (!idx || !fileId) return null
  const n = Math.min(Math.floor(t / idx.interval), Math.max(0, idx.count - 1))
  const per = idx.cols * idx.rows
  const sheet = Math.floor(n / per) + 1
  if (sheet > idx.sheets) return null
  const k = n % per
  const scale = 160 / idx.width
  const w = idx.width * scale
  const h = idx.height * scale
  const x = (k % idx.cols) * w
  const y = Math.floor(k / idx.cols) * h
  const path = `/api/trickplay/${fileId}/${String(sheet).padStart(3, '0')}.jpg`
  return (
    <View style={{ width: w, height: h, overflow: 'hidden', borderRadius: 16, borderWidth: 2, borderColor: c.accent, backgroundColor: c.black, marginBottom: 6 }}>
      <Image
        source={{ uri: abs(path), headers: authHeaders(), cacheKey: path }}
        style={{ position: 'absolute', left: -x, top: -y, width: idx.cols * w, height: idx.rows * h }}
        cachePolicy="memory-disk"
      />
    </View>
  )
}

/** Scrubbable progress bar. Calls onSeek when you let go. */
export default function SeekBar({
  time, duration, buffered, marks, onSeek, onScrubbing, trick,
}: {
  time: number
  duration: number
  buffered: number
  marks?: number[]
  onSeek: (t: number) => void
  onScrubbing?: (on: boolean) => void
  trick: ReturnType<typeof useTrickplay>
}) {
  const styles = useStyles()
  const bar = useRef<React.ComponentRef<typeof View>>(null)
  const geo = useRef({ x: 0, w: 1 })
  const [scrub, setScrub] = useState<number | null>(null)
  const dur = useRef(duration)
  dur.current = duration
  const cb = useRef({ onSeek, onScrubbing })
  cb.current = { onSeek, onScrubbing }

  const measure = () => bar.current?.measureInWindow((x: number, _y: number, w: number) => (geo.current = { x, w: Math.max(1, w) }))
  const at = (pageX: number) => Math.max(0, Math.min(1, (pageX - geo.current.x) / geo.current.w)) * dur.current

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        measure()
        setScrub(at(e.nativeEvent.pageX))
        cb.current.onScrubbing?.(true)
      },
      onPanResponderMove: (e) => setScrub(at(e.nativeEvent.pageX)),
      onPanResponderRelease: (e) => {
        const t = at(e.nativeEvent.pageX)
        setScrub(null)
        cb.current.onScrubbing?.(false)
        cb.current.onSeek(t)
      },
      onPanResponderTerminate: () => {
        setScrub(null)
        cb.current.onScrubbing?.(false)
      },
    }),
  ).current

  const shown = scrub ?? time
  const pct = duration ? (shown / duration) * 100 : 0
  const bufPct = duration ? Math.min(100, (buffered / duration) * 100) : 0
  const left = Math.max(80, Math.min(((pct / 100) * geo.current.w), geo.current.w - 80))

  return (
    <View>
      {scrub !== null && (
        <View pointerEvents="none" style={[styles.preview, { left: left - 80 }]}>
          <Thumb t={scrub} trick={trick} />
          <Text style={styles.previewText}>{formatTime(scrub)}</Text>
        </View>
      )}
      <View style={styles.row}>
        <Text style={styles.time}>{formatTime(shown)}</Text>
        <View ref={bar} onLayout={measure} style={styles.hit} {...pan.panHandlers}>
          {/* M3 Expressive slider: a thick track, a gap either side of a bar-shaped handle. */}
          <View style={styles.track}>
            <View style={[styles.fill, styles.buffered, { width: `${bufPct}%` }]} />
            {marks?.map((m, i) => duration > 0 && <View key={i} style={[styles.mark, { left: `${(m / duration) * 100}%` }]} />)}
          </View>
          <View style={[styles.active, { width: `${pct}%` }]} />
          <View style={[styles.knob, { left: `${pct}%` }, scrub !== null && styles.knobOn]} />
        </View>
        <Text style={styles.time}>-{formatTime(Math.max(0, duration - shown))}</Text>
      </View>
    </View>
  )
}

const useStyles = makeStyles((c, f) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  time: { ...f.labelSmall, color: c.white, fontVariant: ['tabular-nums'], minWidth: 56, textAlign: 'center', fontSize: 12.5 },
  hit: { flex: 1, height: 40, justifyContent: 'center' },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  buffered: { backgroundColor: 'rgba(255,255,255,0.22)' },
  active: { position: 'absolute', left: 0, height: 8, borderRadius: 4, backgroundColor: c.accent },
  mark: { position: 'absolute', top: 0, bottom: 0, width: 3, backgroundColor: 'rgba(0,0,0,0.55)' },
  knob: { position: 'absolute', width: 4, height: 24, borderRadius: 2, marginLeft: -2, backgroundColor: c.accent, borderWidth: 0 },
  knobOn: { height: 32, width: 6, marginLeft: -3, borderRadius: 3 },
  preview: { position: 'absolute', bottom: 44, width: 160, alignItems: 'center', marginLeft: 68 },
  previewText: { ...f.label, color: c.onAccent, backgroundColor: c.accent, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
}), true)
