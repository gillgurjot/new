import { memo, type ReactNode } from 'react'
import { FlatList, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated from 'react-native-reanimated'
import { router } from 'expo-router'
import { Check, CircleCheck, Clock, Download as DownloadIcon, Play } from 'lucide-react-native'
import { errorText, landscapePath, post, posterPath, src, tmdbPath } from '../api/client'
import type { Item, Party, RequestStatus, RequestTitle } from '../api/types'
import { episodeLabel, progressPct, remaining } from '../lib/format'
import { useDownload } from '../lib/downloads'
import { makeStyles, useTheme, type Palette } from '../theme'
import { Button, Img, ProgressBar, SectionTitle, Text, toast } from './ui'
import { Shape, usePressScale } from './expressive'

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

/** A card that sinks a little under the finger and springs back. */
function PressCard({ onPress, onLongPress, label, style, children }: { onPress: () => void; onLongPress?: () => void; label: string; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const { style: scale, onPressIn, onPressOut } = usePressScale(0.05)
  return (
    <Animated.View style={[style, scale]}>
      <Pressable onPress={onPress} onLongPress={onLongPress} onPressIn={onPressIn} onPressOut={onPressOut} accessibilityLabel={label}>
        {children}
      </Pressable>
    </Animated.View>
  )
}

function Badge({ it }: { it: Item }) {
  const s = useStyles()
  const { c } = useTheme()
  const played = <View style={s.played}><Check size={13} color={c.onAccent} strokeWidth={3} /></View>
  if (it.type === 'series' || it.type === 'season') {
    if (it.unplayedCount) return <View style={s.count}><Text style={s.countText}>{it.unplayedCount}</Text></View>
    if (it.childCount && it.unplayedCount === 0) return played
    return null
  }
  return it.userData?.played ? played : null
}

function DownloadedDot({ id }: { id: number }) {
  const s = useStyles()
  const d = useDownload(id)
  if (!d || d.state !== 'done') return null
  return <View style={s.dl}><DownloadIcon size={12} color="#fff" strokeWidth={2.5} /></View>
}

export const PosterCard = memo(function PosterCard({ it, width = 120, onPress }: { it: Item; width?: number; onPress?: () => void }) {
  const s = useStyles()
  const { c } = useTheme()
  const pct = progressPct(it)
  return (
    <PressCard onPress={onPress ?? (() => openItem(it))} label={it.title} style={{ width }}>
      <View style={[s.poster, { width, height: width * 1.5 }]}>
        <Img source={src(posterPath(it, width))} style={StyleSheet.absoluteFill} fallback={<Text style={s.fallback} numberOfLines={3}>{it.title}</Text>} />
        <Badge it={it} />
        <DownloadedDot id={it.id} />
        {pct > 0 && pct < 100 && (
          <View style={s.posterProgress}>
            <ProgressBar pct={pct} color={c.accent} track="rgba(255,255,255,0.35)" />
          </View>
        )}
      </View>
      <Text style={s.title} numberOfLines={1}>{it.type === 'episode' ? it.seriesTitle : it.title}</Text>
      <Text style={s.sub} numberOfLines={1}>{it.type === 'episode' ? episodeLabel(it) : it.year || ''}</Text>
    </PressCard>
  )
})

/** Wide card for Continue watching / Next up: artwork, progress and time left. */
export const LandscapeCard = memo(function LandscapeCard({ it, width = 260, play = true }: { it: Item; width?: number; play?: boolean }) {
  const s = useStyles()
  const { c } = useTheme()
  const pct = progressPct(it)
  return (
    <PressCard onPress={() => (play ? playItem(it.id) : openItem(it))} onLongPress={() => openItem(it)} label={`Play ${it.seriesTitle || it.title}`} style={{ width }}>
      <View style={[s.land, { width, height: (width * 9) / 16 }]}>
        <Img source={src(landscapePath(it, width))} style={StyleSheet.absoluteFill} />
        <Shape name="cookie9" size={40} color={c.accentContainer} style={s.playShape}>
          <Play size={17} color={c.onAccentContainer} fill={c.onAccentContainer} style={{ marginLeft: 2 }} />
        </Shape>
        <DownloadedDot id={it.id} />
        {pct > 0 && (
          <View style={s.landProgress}>
            <ProgressBar pct={pct} color={c.accent} track="rgba(255,255,255,0.35)" />
          </View>
        )}
      </View>
      <Text style={s.title} numberOfLines={1}>{it.type === 'episode' ? it.seriesTitle : it.title}</Text>
      <Text style={s.sub} numberOfLines={1}>
        {[it.type === 'episode' ? `${episodeLabel(it)} · ${it.title}` : '', pct > 0 ? remaining(it) : ''].filter(Boolean).join('  ·  ') || (it.year ? String(it.year) : '')}
      </Text>
    </PressCard>
  )
})

export function Row({ title, items, kind = 'poster', onMore }: { title: string; items: Item[]; kind?: 'poster' | 'landscape'; onMore?: () => void }) {
  if (!items.length) return null
  return (
    <View style={{ marginBottom: 28 }}>
      <SectionTitle right={onMore && <Button variant="text" size="s" title="See all" onPress={onMore} style={{ marginRight: -12 }} />}>{title}</SectionTitle>
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

export interface StatusInfo {
  label: string
  bg: string
  fg: string
  Icon?: typeof Check
}

export function statusInfo(c: Palette, status: RequestStatus): StatusInfo {
  return {
    none: { label: '', bg: '', fg: '' },
    pending: { label: 'Requested', bg: c.tertiaryContainer, fg: c.onTertiaryContainer, Icon: Clock },
    processing: { label: 'Downloading', bg: c.secondaryContainer, fg: c.onSecondaryContainer, Icon: DownloadIcon },
    partial: { label: 'Partly here', bg: c.surface4, fg: c.fg, Icon: Check },
    available: { label: 'In library', bg: c.accent, fg: c.onAccent, Icon: CircleCheck },
  }[status]
}

export const RequestCard = memo(function RequestCard({ t, width, onPress }: { t: RequestTitle; width: number; onPress: () => void }) {
  const s = useStyles()
  const { c } = useTheme()
  const st = statusInfo(c, t.status)
  return (
    <PressCard onPress={onPress} label={t.title} style={{ width }}>
      <View style={[s.poster, { width, height: width * 1.5 }]}>
        <Img source={src(tmdbPath(t.poster, 'w342'))} style={StyleSheet.absoluteFill} fallback={<Text style={s.fallback} numberOfLines={3}>{t.title}</Text>} />
        {!!st.label && (
          <View style={[s.status, { backgroundColor: st.bg }]}>
            {st.Icon && <st.Icon size={11} color={st.fg} strokeWidth={2.75} />}
            <Text style={[s.statusText, { color: st.fg }]}>{st.label}</Text>
          </View>
        )}
      </View>
      <Text style={s.title} numberOfLines={1}>{t.title}</Text>
      <Text style={s.sub}>{[t.mediaType === 'tv' ? 'Show' : 'Movie', t.year].filter(Boolean).join(' · ')}</Text>
    </PressCard>
  )
})

const useStyles = makeStyles((c, f) => ({
  poster: { borderRadius: 16, overflow: 'hidden', backgroundColor: c.surface3 },
  land: { borderRadius: 20, overflow: 'hidden', backgroundColor: c.surface3 },
  title: { ...f.label, fontSize: 13.5, marginTop: 8 },
  sub: { ...f.tiny, marginTop: 1 },
  fallback: { ...f.labelSmall, textAlign: 'center', padding: 8 },
  count: { position: 'absolute', top: 7, right: 7, minWidth: 24, height: 24, borderRadius: 12, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7 },
  countText: { ...f.labelSmall, color: c.onAccent, fontWeight: '700' },
  played: { position: 'absolute', top: 7, right: 7, width: 24, height: 24, borderRadius: 8, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
  dl: { position: 'absolute', top: 7, left: 7, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  playShape: { position: 'absolute', left: 10, bottom: 14 },
  posterProgress: { position: 'absolute', left: 8, right: 8, bottom: 8 },
  landProgress: { position: 'absolute', left: 12, right: 12, bottom: 8 },
  status: { position: 'absolute', top: 7, left: 7, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 22, borderRadius: 11 },
  statusText: { ...f.labelSmall, fontSize: 10.5, letterSpacing: 0.2 },
}))
