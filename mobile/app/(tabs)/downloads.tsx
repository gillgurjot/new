import { useMemo } from 'react'
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Download as DownloadIcon, Play } from 'lucide-react-native'
import DownloadButton from '../../src/components/DownloadButton'
import { playItem } from '../../src/components/cards'
import { EmptyState, Img, PageTitle, ProgressBar } from '../../src/components/ui'
import { type Download, downloadsSize, freeSpace, useDownloads } from '../../src/lib/downloads'
import { bytes, episodeLabel, formatRuntime } from '../../src/lib/format'
import { useUser } from '../../src/lib/auth'
import { c, font, radius } from '../../src/theme'

export default function Downloads() {
  const insets = useSafeAreaInsets()
  const user = useUser()
  const all = useDownloads()
  const sections = useMemo(() => {
    const active = all.filter((d) => d.state !== 'done')
    const done = all.filter((d) => d.state === 'done')
    // Group episodes under their show.
    const movies = done.filter((d) => d.item.type !== 'episode')
    const shows = new Map<string, Download[]>()
    for (const d of done.filter((x) => x.item.type === 'episode')) {
      const k = d.item.seriesTitle || 'Episodes'
      shows.set(k, [...(shows.get(k) || []), d])
    }
    const out: { title: string; data: Download[] }[] = []
    if (active.length) out.push({ title: 'In progress', data: active })
    if (movies.length) out.push({ title: 'Movies', data: movies })
    for (const [k, v] of shows) {
      out.push({ title: k, data: v.sort((a, b) => (a.item.seasonNumber ?? 0) - (b.item.seasonNumber ?? 0) || (a.item.episodeNumber ?? 0) - (b.item.episodeNumber ?? 0)) })
    }
    return out
  }, [all])

  return (
    <SectionList
      sections={sections}
      keyExtractor={(d) => String(d.itemId)}
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: 40 }}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View style={{ paddingHorizontal: 16 }}>
          <PageTitle sub={all.length ? `${bytes(downloadsSize())} used · ${bytes(freeSpace())} free on this phone` : undefined}>Downloads</PageTitle>
        </View>
      }
      ListEmptyComponent={
        <EmptyState icon={<DownloadIcon size={26} color={c.muted} />} title="No downloads yet">
          {user?.canDownload
            ? 'Tap the download button on a movie or episode. The original file is saved to this phone, so it plays anywhere, even with no connection.'
            : 'Downloads are turned off for your account. Ask an admin to turn them on.'}
        </EmptyState>
      }
      renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
      renderItem={({ item: d }) => <DownloadRow d={d} />}
    />
  )
}

function DownloadRow({ d }: { d: Download }) {
  const it = d.item
  const pct = d.total ? (d.bytes / d.total) * 100 : 0
  const watched = it.duration ? (d.position / it.duration) * 100 : 0
  const status =
    d.state === 'downloading' ? `${Math.floor(pct)}% · ${bytes(d.bytes)} of ${bytes(d.total)}`
      : d.state === 'paused' ? `Paused · ${bytes(d.bytes)} of ${bytes(d.total)}`
        : d.state === 'failed' ? d.error || 'Failed'
          : [it.type === 'episode' ? episodeLabel(it) : it.year, formatRuntime(it.runtime, it.duration), bytes(d.total)].filter(Boolean).join(' · ')
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => (d.state === 'done' ? playItem(it.id) : router.push({ pathname: '/item/[id]', params: { id: String(it.id) } }))}
        style={({ pressed }) => [styles.thumb, pressed && { opacity: 0.8 }]}
        accessibilityLabel={`Play ${it.title}`}
      >
        <Img source={d.landscape ? { uri: d.landscape } : undefined} style={StyleSheet.absoluteFill} />
        {d.state === 'done' && <View style={styles.play}><Play size={14} color={c.white} fill={c.white} /></View>}
        {d.state === 'done' && watched > 1 && <ProgressBar pct={watched} color={c.white} style={{ position: 'absolute', left: 6, right: 6, bottom: 6 }} />}
      </Pressable>
      <Pressable style={{ flex: 1 }} onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(it.id) } })}>
        <Text style={styles.title} numberOfLines={2}>{it.title}</Text>
        <Text style={[font.small, d.state === 'failed' && { color: c.warn }]} numberOfLines={2}>{status}</Text>
        {(d.state === 'downloading' || d.state === 'paused') && <ProgressBar pct={pct} style={{ marginTop: 8 }} />}
      </Pressable>
      <DownloadButton itemId={it.id} compact />
    </View>
  )
}

const styles = StyleSheet.create({
  section: { ...font.h3, paddingHorizontal: 16, marginTop: 18, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  thumb: { width: 128, height: 72, borderRadius: radius.md, overflow: 'hidden', backgroundColor: c.surface2 },
  play: { position: 'absolute', top: '50%', left: '50%', marginLeft: -15, marginTop: -15, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
  title: { color: c.fg, fontSize: 15, fontWeight: '600', marginBottom: 3 },
})
