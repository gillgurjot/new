import { memo } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Check, CircleCheck, Clock, Download as DownloadIcon, Play } from 'lucide-react-native'
import { errorText, landscapePath, post, posterPath, src, tmdbPath } from '../api/client'
import type { Item, Party, RequestStatus, RequestTitle } from '../api/types'
import { episodeLabel, progressPct, remaining } from '../lib/format'
import { useDownload } from '../lib/downloads'
import { c, font, radius } from '../theme'
import { Img, ProgressBar, SectionTitle, toast } from './ui'

export function openItem(it: Item) {
  if (it.type === 'season' && it.parentId) router.push({ pathname: '/item/[id]', params: { id: String(it.parentId), season: String(it.id) } })
  else router.push({ pathname: '/item/[id]', params: { id: String(it.id) } })
}

export const playItem = (id: number, extra?: Record<string, string>) => router.push({ pathname: '/play/[id]', params: { id: String(id), ...extra } })

export const openRequest = (t: RequestTitle) => router.push({ pathname: '/request/[type]/[id]', params: { type: t.mediaType, id: String(t.tmdbId) } })

/** Starts a watch party and opens the player with the invite panel. */
export async function startParty(itemId: number, position = 0) {
  try {
    const p = await post<Party>('/api/party', { itemId, position })
    playItem(itemId, { party: p.id, invite: '1' })
  } catch (e) {
    toast(errorText(e, 'Couldn’t start a watch party'), 'error')
  }
}

function Badge({ it }: { it: Item }) {
  if (it.type === 'series' || it.type === 'season') {
    if (it.unplayedCount) return <View style={styles.count}><Text style={styles.countText}>{it.unplayedCount}</Text></View>
    if (it.childCount && it.unplayedCount === 0) return <View style={styles.played}><Check size={12} color={c.black} strokeWidth={3} /></View>
    return null
  }
  if (it.userData?.played) return <View style={styles.played}><Check size={12} color={c.black} strokeWidth={3} /></View>
  return null
}

function DownloadedDot({ id }: { id: number }) {
  const d = useDownload(id)
  if (!d || d.state !== 'done') return null
  return <View style={styles.dl}><DownloadIcon size={11} color={c.white} strokeWidth={2.5} /></View>
}

export const PosterCard = memo(function PosterCard({ it, width = 120, onPress }: { it: Item; width?: number; onPress?: () => void }) {
  const pct = progressPct(it)
  return (
    <Pressable onPress={onPress ?? (() => openItem(it))} style={({ pressed }) => [{ width }, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]} accessibilityLabel={it.title}>
      <View style={[styles.poster, { width, height: width * 1.5 }]}>
        <Img source={src(posterPath(it, width))} style={StyleSheet.absoluteFill} fallback={<Text style={styles.fallback} numberOfLines={3}>{it.title}</Text>} />
        <Badge it={it} />
        <DownloadedDot id={it.id} />
        {pct > 0 && pct < 100 && <ProgressBar pct={pct} style={{ position: 'absolute', left: 6, right: 6, bottom: 6 }} />}
      </View>
      <Text style={styles.title} numberOfLines={1}>{it.type === 'episode' ? it.seriesTitle : it.title}</Text>
      <Text style={styles.sub} numberOfLines={1}>{it.type === 'episode' ? episodeLabel(it) : it.year || ''}</Text>
    </Pressable>
  )
})

/** Wide card for Continue watching / Next up: artwork, progress and time left. */
export const LandscapeCard = memo(function LandscapeCard({ it, width = 260, play = true }: { it: Item; width?: number; play?: boolean }) {
  const pct = progressPct(it)
  return (
    <Pressable
      onPress={() => (play ? playItem(it.id) : openItem(it))}
      onLongPress={() => openItem(it)}
      style={({ pressed }) => [{ width }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
      accessibilityLabel={`Play ${it.seriesTitle || it.title}`}
    >
      <View style={[styles.land, { width, height: (width * 9) / 16 }]}>
        <Img source={src(landscapePath(it, width))} style={StyleSheet.absoluteFill} />
        <View style={styles.playDot}><Play size={16} color={c.white} fill={c.white} /></View>
        <DownloadedDot id={it.id} />
        {pct > 0 && <ProgressBar pct={pct} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, borderRadius: 0 }} />}
      </View>
      <Text style={styles.title} numberOfLines={1}>{it.type === 'episode' ? it.seriesTitle : it.title}</Text>
      <Text style={styles.sub} numberOfLines={1}>
        {[it.type === 'episode' ? `${episodeLabel(it)} · ${it.title}` : '', pct > 0 ? remaining(it) : ''].filter(Boolean).join('  ·  ') || (it.year ? String(it.year) : '')}
      </Text>
    </Pressable>
  )
})

export function Row({ title, items, kind = 'poster', onMore }: { title: string; items: Item[]; kind?: 'poster' | 'landscape'; onMore?: () => void }) {
  if (!items.length) return null
  return (
    <View style={{ marginBottom: 26 }}>
      <SectionTitle right={onMore && <Text onPress={onMore} style={{ color: c.accent, fontWeight: '600' }}>See all</Text>}>{title}</SectionTitle>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(i) => String(i.id)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
        renderItem={({ item }) => (kind === 'landscape' ? <LandscapeCard it={item} /> : <PosterCard it={item} />)}
        initialNumToRender={6}
        windowSize={5}
      />
    </View>
  )
}

export const statusInfo: Record<RequestStatus, { label: string; bg: string; Icon?: typeof Check }> = {
  none: { label: '', bg: '' },
  pending: { label: 'Requested', bg: c.warn, Icon: Clock },
  processing: { label: 'Downloading', bg: c.info, Icon: DownloadIcon },
  partial: { label: 'Partly here', bg: c.white, Icon: Check },
  available: { label: 'In library', bg: c.success, Icon: CircleCheck },
}

export const RequestCard = memo(function RequestCard({ t, width, onPress }: { t: RequestTitle; width: number; onPress: () => void }) {
  const st = statusInfo[t.status]
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ width }, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]} accessibilityLabel={t.title}>
      <View style={[styles.poster, { width, height: width * 1.5 }]}>
        <Img source={src(tmdbPath(t.poster, 'w342'))} style={StyleSheet.absoluteFill} fallback={<Text style={styles.fallback} numberOfLines={3}>{t.title}</Text>} />
        {!!st.label && (
          <View style={[styles.status, { backgroundColor: st.bg }]}>
            {st.Icon && <st.Icon size={10} color={c.black} strokeWidth={3} />}
            <Text style={styles.statusText}>{st.label}</Text>
          </View>
        )}
      </View>
      <Text style={styles.title} numberOfLines={1}>{t.title}</Text>
      <Text style={styles.sub}>{[t.mediaType === 'tv' ? 'Show' : 'Movie', t.year].filter(Boolean).join(' · ')}</Text>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  poster: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: c.surface2, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.06)' },
  land: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: c.surface2 },
  title: { ...font.body, fontSize: 13, fontWeight: '600', marginTop: 7 },
  sub: { ...font.tiny, fontSize: 12, marginTop: 1 },
  fallback: { color: c.muted, fontSize: 13, fontWeight: '600', textAlign: 'center', padding: 8 },
  count: { position: 'absolute', top: 6, right: 6, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: c.accentStrong, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countText: { color: c.white, fontSize: 11, fontWeight: '800' },
  played: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: c.white, alignItems: 'center', justifyContent: 'center' },
  dl: { position: 'absolute', top: 6, left: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  playDot: { position: 'absolute', left: 10, bottom: 12, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
  status: { position: 'absolute', top: 6, left: 6, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, height: 20, borderRadius: 6 },
  statusText: { fontSize: 9.5, fontWeight: '800', color: c.black, textTransform: 'uppercase', letterSpacing: 0.3 },
})
