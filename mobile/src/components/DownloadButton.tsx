import { useState } from 'react'
import { Alert, Pressable, StyleSheet, View } from 'react-native'
import { CircleCheck, Download as DownloadIcon, Pause, Play, RotateCcw, Trash2, TriangleAlert } from 'lucide-react-native'
import Svg, { Circle } from 'react-native-svg'
import { api, errorText } from '../api/client'
import type { ItemDetail } from '../api/types'
import { bytes } from '../lib/format'
import { pauseDownload, removeDownload, resumeDownload, retryDownload, startDownload, useDownload } from '../lib/downloads'
import { alpha, makeStyles, useTheme } from '../theme'
import { MenuSheet, Text, toast } from './ui'
import { deviceProfile } from '../lib/profile'
import { playItem } from './cards'

function canPlayOffline(codec: string, pixFmt?: string) {
  if (!deviceProfile().videoCodecs.includes(codec)) return false
  return !(codec === 'h264' && pixFmt?.includes('10'))
}

function Ring({ pct, size }: { pct: number; size: number }) {
  const { c } = useTheme()
  const r = size / 2 - 2.5
  const len = 2 * Math.PI * r
  return (
    <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={alpha(c.onSecondaryContainer, 0.18)} strokeWidth={2.5} fill="none" />
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={c.accent} strokeWidth={2.5} fill="none" strokeDasharray={`${len}`} strokeDashoffset={len * (1 - pct / 100)} strokeLinecap="round" rotation={-90} origin={`${size / 2}, ${size / 2}`} />
    </Svg>
  )
}

/**
 * Download state for one title: start, progress ring, pause/resume, play offline, delete.
 * `label` shows the text under the button (title page); compact for episode rows.
 */
export default function DownloadButton({ itemId, size, label, compact, videoCodec, pixFmt }: { itemId: number; size?: number; label?: boolean; compact?: boolean; videoCodec?: string; pixFmt?: string }) {
  const { c } = useTheme()
  const st = useStyles()
  const d = useDownload(itemId)
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const s = compact ? 40 : 48
  const pct = d && d.total ? (d.bytes / d.total) * 100 : 0

  const start = async () => {
    // Offline there's no server to convert, so warn when the phone can't decode the file itself.
    let codec = videoCodec
    let fmt = pixFmt
    if (!codec) {
      const it = await api<ItemDetail>(`/api/items/${itemId}`).catch(() => null)
      codec = it?.media?.videoCodec
      fmt = it?.media?.pixFmt
    }
    if (codec && !canPlayOffline(codec, fmt)) {
      const videoCodec = codec
      const pixFmt = fmt
      const go = await new Promise<boolean>((res) =>
        Alert.alert('This phone may not play this file', `It's ${videoCodec.toUpperCase()}${pixFmt?.includes('10') ? ' 10-bit' : ''} video, which this phone can't decode by itself. Streaming still works because the server converts it, but the downloaded copy may not play.`, [
          { text: 'Cancel', style: 'cancel', onPress: () => res(false) },
          { text: 'Download anyway', onPress: () => res(true) },
        ]),
      )
      if (!go) return
    }
    setBusy(true)
    try {
      await startDownload(itemId)
      toast(size ? `Downloading ${bytes(size)}` : 'Download started', 'info')
    } catch (e) {
      toast(errorText(e, 'Couldn’t start the download'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = () =>
    Alert.alert('Remove download?', 'The copy on this phone will be deleted. You can download it again later.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeDownload(itemId) },
    ])

  let icon = <DownloadIcon size={compact ? 18 : 20} color={compact ? c.muted : c.onSecondaryContainer} />
  let text = 'Download'
  if (d?.state === 'downloading') {
    icon = <Text style={st.pct}>{Math.floor(pct)}%</Text>
    text = 'Downloading'
  } else if (d?.state === 'paused') {
    icon = <Pause size={16} color={c.onSecondaryContainer} />
    text = 'Paused'
  } else if (d?.state === 'done') {
    icon = <CircleCheck size={compact ? 18 : 20} color={c.accent} />
    text = 'Downloaded'
  } else if (d?.state === 'failed') {
    icon = <TriangleAlert size={18} color={c.warn} />
    text = 'Retry'
  }

  return (
    <>
      <Pressable
        onPress={() => (d ? setMenu(true) : start())}
        disabled={busy}
        style={({ pressed }) => [{ alignItems: 'center', width: compact ? s : 72 }, pressed && { opacity: 0.7 }]}
        accessibilityLabel={text}
        hitSlop={4}
      >
        <View style={[st.circle, { width: s, height: s, borderRadius: s / 2 }, compact && { backgroundColor: 'transparent' }]}>
          {(d?.state === 'downloading' || d?.state === 'paused') && <Ring pct={pct} size={s} />}
          {icon}
        </View>
        {label && <Text style={st.label} numberOfLines={1}>{text}</Text>}
      </Pressable>
      <MenuSheet
        open={menu}
        onClose={() => setMenu(false)}
        title={d?.item.title}
        note={
          d?.state === 'downloading' || d?.state === 'paused'
            ? `${bytes(d.bytes)} of ${bytes(d.total)} · it keeps going if you leave the app`
            : d?.state === 'done'
              ? `${bytes(d.total)} on this phone`
              : d?.error
        }
        options={[
          ...(d?.state === 'done' ? [{ label: 'Play downloaded copy', icon: Play, onPress: () => playItem(itemId) }] : []),
          ...(d?.state === 'downloading' ? [{ label: 'Pause', icon: Pause, onPress: () => pauseDownload(itemId) }] : []),
          ...(d?.state === 'paused' ? [{ label: 'Resume', icon: Play, onPress: () => resumeDownload(itemId) }] : []),
          ...(d?.state === 'failed' ? [{ label: 'Try again', icon: RotateCcw, onPress: () => retryDownload(itemId).catch((e) => toast(errorText(e), 'error')) }] : []),
          { label: d?.state === 'done' ? 'Remove download' : 'Cancel download', danger: true, icon: Trash2, onPress: d?.state === 'done' ? confirmDelete : () => removeDownload(itemId) },
        ]}
      />
    </>
  )
}

const useStyles = makeStyles((c, f) => ({
  circle: { backgroundColor: c.secondaryContainer, alignItems: 'center', justifyContent: 'center' },
  pct: { ...f.labelSmall, fontSize: 10.5, color: c.onSecondaryContainer, fontWeight: '700' },
  label: { ...f.labelSmall, marginTop: 6 },
}))
