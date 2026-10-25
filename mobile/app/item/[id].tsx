import { useEffect, useMemo, useState } from 'react'
import { FlatList, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LinearGradient } from 'expo-linear-gradient'
import { Check, ChevronDown, Heart, Play, RefreshCw, RotateCcw, Star, Users, type LucideIcon } from 'lucide-react-native'
import { api, del, errorText, imagePath, landscapePath, personPath, post, src } from '../../src/api/client'
import type { Item, ItemDetail, UserData } from '../../src/api/types'
import DownloadButton from '../../src/components/DownloadButton'
import { playItem, startParty } from '../../src/components/cards'
import { Button, Chip, Header, IconButton, Img, Loading, ProgressBar, Text, toast } from '../../src/components/ui'
import { Shape } from '../../src/components/expressive'
import { bytes, channelLabel, episodeLabel, formatRuntime, formatTime, langLabel, plural, progressPct, resolutionLabel } from '../../src/lib/format'
import { useDownload } from '../../src/lib/downloads'
import { useUser } from '../../src/lib/auth'
import { alpha, makeStyles, useTheme } from '../../src/theme'

export default function ItemScreen() {
  const { id, season } = useLocalSearchParams<{ id: string; season?: string }>()
  const { c, f: font } = useTheme()
  const qc = useQueryClient()
  const dl = useDownload(Number(id))
  const q = useQuery({ queryKey: ['item', Number(id)], queryFn: () => api<ItemDetail>(`/api/items/${id}`), refetchOnMount: 'always' })
  // Offline: a downloaded title still has its page.
  const item = q.data ?? dl?.item
  if (!item) {
    return (
      <View style={{ flex: 1 }}>
        <Header />
        {q.error ? <Text style={[font.body, { textAlign: 'center', marginTop: 60, color: c.muted }]}>{errorText(q.error, 'This title isn’t available.')}</Text> : <Loading />}
      </View>
    )
  }
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['item'] })
    qc.invalidateQueries({ queryKey: ['children'] })
    qc.invalidateQueries({ queryKey: ['home'] })
    qc.invalidateQueries({ queryKey: ['favorites'] })
  }
  return <Detail key={item.id} item={item} onChange={refresh} season={season ? Number(season) : undefined} offline={!q.data} />
}

function Detail({ item, onChange, season, offline }: { item: ItemDetail; onChange: () => void; season?: number; offline: boolean }) {
  const user = useUser()
  const { c, f: font } = useTheme()
  const styles = useStyles()
  const { width } = useWindowDimensions()
  const isPlayable = item.type === 'movie' || item.type === 'episode'
  const backdropId = item.type === 'movie' || item.type === 'series' ? item.id : item.seriesId
  const backdrop = item.images.backdrop ? imagePath(item, 'backdrop', width) : backdropId ? `/api/images/${backdropId}/backdrop?w=${Math.round(width * 2)}` : landscapePath(item, width)
  const logo = item.type === 'movie' || item.type === 'series' ? imagePath(item, 'logo', 400) : undefined
  const dl = useDownload(item.id)
  const heroH = Math.round(width * 0.78)

  const seriesId = item.type === 'series' ? item.id : item.seriesId
  const episodes = useQuery({
    queryKey: ['children', 'episodes', seriesId],
    queryFn: () => api<Item[]>(`/api/items/${seriesId}/episodes`),
    enabled: !offline && (item.type === 'series' || item.type === 'season'),
  })
  const nextEp = useMemo(() => {
    const eps = episodes.data || []
    const regular = eps.filter((e) => e.seasonNumber !== 0)
    const inProgress = regular.find((e) => !e.userData?.played && (e.userData?.position || 0) > 30)
    if (inProgress) return inProgress
    let lastIdx = -1
    regular.forEach((e, i) => e.userData?.played && (lastIdx = i))
    return regular.slice(lastIdx + 1).find((e) => !e.userData?.played) || regular[0] || eps[0]
  }, [episodes.data])

  const playTarget = isPlayable ? item : nextEp
  const resumePos = playTarget?.userData?.played ? 0 : (isPlayable && dl ? Math.max(dl.position, playTarget?.userData?.position || 0) : playTarget?.userData?.position || 0)
  const ud = item.userData
  const toggle = async (kind: 'played' | 'favorite', on: boolean) => {
    try {
      await (on ? post<UserData>(`/api/items/${item.id}/${kind}`) : del<UserData>(`/api/items/${item.id}/${kind}`))
      if (kind === 'favorite') toast(on ? 'Added to My List' : 'Removed from My List', 'info')
      onChange()
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }
  const refreshMeta = async () => {
    try {
      await post(`/api/admin/items/${item.id}/refresh`)
      toast('Refreshing details…', 'info')
      setTimeout(onChange, 4000)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }

  const directors = item.people?.filter((p) => p.role === 'director' || p.role === 'creator') || []
  const cast = item.people?.filter((p) => p.role === 'actor' || p.role === 'guest') || []
  const playLabel = resumePos > 30 ? `Resume ${formatTime(resumePos)}` : !isPlayable && playTarget ? `Play ${episodeLabel(playTarget)}` : 'Play'
  const audio = item.media?.streams.filter((s) => s.type === 'audio') || []

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        <View style={{ height: heroH }}>
          <Img source={src(backdrop)} style={StyleSheet.absoluteFill} transition={300} />
          <LinearGradient colors={[alpha(c.bg, 0.5), alpha(c.bg, 0), alpha(c.bg, 0.6), c.bg]} locations={[0, 0.3, 0.7, 1]} style={StyleSheet.absoluteFill} />
        </View>
        <View style={{ paddingHorizontal: 16, marginTop: -70 }}>
          {!!item.seriesTitle && (
            <Text onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(item.seriesId) } })} style={styles.series}>{item.seriesTitle}</Text>
          )}
          {logo ? (
            <Img source={src(logo)} style={{ width: width * 0.66, height: 84, backgroundColor: 'transparent', marginBottom: 10 }} contentFit="contain" fallback={<Text style={styles.title}>{item.title}</Text>} />
          ) : (
            <Text style={styles.title}>{item.title}</Text>
          )}
          <View style={styles.metaRow}>
            {item.type === 'episode' && <Text style={[styles.meta, { color: c.fg }]}>{episodeLabel(item)}</Text>}
            {!!item.year && <Text style={styles.meta}>{item.year}</Text>}
            {!!item.rating && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Star size={13} color={c.warn} fill={c.warn} />
                <Text style={styles.meta}>{item.rating.toFixed(1)}</Text>
              </View>
            )}
            {!!item.contentRating && <Text style={styles.tag}>{item.contentRating}</Text>}
            {isPlayable && !!formatRuntime(item.runtime, item.duration) && <Text style={styles.meta}>{formatRuntime(item.runtime, item.duration)}</Text>}
            {item.type === 'series' && !!item.childCount && <Text style={styles.meta}>{plural(item.childCount, 'season')}</Text>}
            {item.media && <Text style={styles.tag}>{resolutionLabel(item.media.width, item.media.height)}</Text>}
            {!!item.media?.hdr && <Text style={[styles.tag, styles.tagHdr]}>{item.media.hdr === 'dovi' ? 'Dolby Vision' : item.media.hdr.toUpperCase()}</Text>}
          </View>

          {playTarget && (
            <Button variant="filled" size="l" title={playLabel} icon={Play} iconFill onPress={() => playItem(playTarget.id)} />
          )}
          {playTarget && resumePos > 30 && (playTarget.duration || 0) > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <ProgressBar pct={(resumePos / (playTarget.duration || 1)) * 100} style={{ flex: 1 }} />
              <Text style={font.tiny}>{formatTime(Math.max(0, (playTarget.duration || 0) - resumePos))} left</Text>
            </View>
          )}

          <View style={styles.actions}>
            {playTarget && resumePos > 30 && <Action label="Start over" onPress={() => playItem(playTarget.id, { t: '0' })} icon={RotateCcw} />}
            {playTarget && !offline && <Action label="Together" onPress={() => startParty(playTarget.id, resumePos > 30 ? resumePos : 0)} icon={Users} />}
            {!offline && <Action label="My List" on={ud?.favorite} onPress={() => toggle('favorite', !ud?.favorite)} icon={Heart} fill={!!ud?.favorite} />}
            {!offline && <Action label="Watched" on={ud?.played} onPress={() => toggle('played', !ud?.played)} icon={Check} />}
            {isPlayable && item.media && (user.canDownload || dl) && <DownloadButton itemId={item.id} size={item.media.size} videoCodec={item.media.videoCodec} pixFmt={item.media.pixFmt} label />}
            {user.isAdmin && !offline && (item.type === 'movie' || item.type === 'series') && <Action label="Refresh" onPress={refreshMeta} icon={RefreshCw} />}
          </View>

          {!!item.tagline && <Text style={styles.tagline}>{item.tagline}</Text>}
          <Overview text={item.overview} />
          {item.genres.length > 0 && <Text style={[font.small, { marginTop: 12 }]}>{item.genres.join(' · ')}</Text>}
          {audio.length > 1 && (
            <Text style={[font.small, { marginTop: 6 }]}>
              Audio: <Text style={{ color: c.dim }}>{audio.map((a) => [langLabel(a.language), channelLabel(a.channels)].filter(Boolean).join(' ')).join(' · ')}</Text>
            </Text>
          )}
          {directors.length > 0 && (
            <Text style={[font.small, { marginTop: 6 }]}>
              {directors[0].role === 'creator' ? 'Created by ' : 'Directed by '}
              <Text style={{ color: c.dim }}>{directors.map((d) => d.name).join(', ')}</Text>
            </Text>
          )}
        </View>

        {(item.type === 'series' || item.type === 'season') && !offline && <Seasons item={item} episodes={episodes.data} initialSeason={season} />}

        {cast.length > 0 && (
          <View style={{ marginTop: 30 }}>
            <Text style={[font.h2, { fontSize: 20, paddingHorizontal: 16, marginBottom: 12 }]}>{item.type === 'episode' ? 'Guest stars' : 'Cast'}</Text>
            <FlatList
              horizontal
              data={cast}
              keyExtractor={(p, i) => p.name + i}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 14 }}
              renderItem={({ item: p }) => (
                <View style={{ width: 84 }}>
                  <Img source={src(personPath(p.profile))} style={{ width: 84, height: 84, borderRadius: 42 }} fallback={<Text style={[font.h2, { color: c.muted }]}>{p.name[0]}</Text>} />
                  <Text style={styles.castName} numberOfLines={1}>{p.name}</Text>
                  <Text style={[font.tiny, { textAlign: 'center' }]} numberOfLines={1}>{p.character}</Text>
                </View>
              )}
            />
          </View>
        )}

        {item.media && <MediaInfo item={item} />}
      </ScrollView>
      <Header transparent />
    </View>
  )
}

function Action({ label, icon, onPress, on, fill }: { label: string; icon: LucideIcon; onPress: () => void; on?: boolean; fill?: boolean }) {
  const styles = useStyles()
  return (
    <View style={{ alignItems: 'center', width: 72 }}>
      <IconButton label={label} icon={icon} onPress={onPress} selected={on} fill={fill} size={48} variant="tonal" />
      <Text style={styles.actionLabel} numberOfLines={1}>{label}</Text>
    </View>
  )
}

function Overview({ text }: { text?: string }) {
  const { c } = useTheme()
  const styles = useStyles()
  const [open, setOpen] = useState(false)
  if (!text) return null
  const long = text.length > 200
  return (
    <Pressable onPress={() => long && setOpen((o) => !o)}>
      <Text style={styles.overview} numberOfLines={open || !long ? undefined : 4}>{text}</Text>
      {long && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
          <Text style={styles.more}>{open ? 'Less' : 'More'}</Text>
          <ChevronDown size={16} color={c.accent} style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }} />
        </View>
      )}
    </Pressable>
  )
}

function Seasons({ item, episodes, initialSeason }: { item: ItemDetail; episodes?: Item[]; initialSeason?: number }) {
  const seriesId = item.type === 'series' ? item.id : item.seriesId!
  const seasons = useQuery({ queryKey: ['children', seriesId], queryFn: () => api<Item[]>(`/api/items/${seriesId}/children`) })
  const list = seasons.data || []
  const initial = item.type === 'season' ? item.id : initialSeason || list.find((s) => s.unplayedCount && s.seasonNumber !== 0)?.id || list[0]?.id
  const [sel, setSel] = useState<number | undefined>(initial)
  useEffect(() => setSel(initial), [initial])
  const eps = (episodes || []).filter((e) => e.parentId === sel)
  if (!list.length) return null
  return (
    <View style={{ marginTop: 28 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, marginBottom: 14 }}>
        {list.map((s) => <Chip key={s.id} label={s.unplayedCount ? `${s.title}  ${s.unplayedCount}` : s.title} active={sel === s.id} onPress={() => setSel(s.id)} />)}
      </ScrollView>
      {!episodes && <Loading style={{ paddingVertical: 30 }} />}
      {eps.map((e) => <EpisodeRow key={e.id} ep={e} />)}
    </View>
  )
}

function EpisodeRow({ ep }: { ep: Item }) {
  const user = useUser()
  const { c, f: font } = useTheme()
  const styles = useStyles()
  const dl = useDownload(ep.id)
  const pct = progressPct(ep)
  return (
    <View style={styles.ep}>
      <Pressable onPress={() => playItem(ep.id)} style={({ pressed }) => [styles.epThumb, pressed && { opacity: 0.8 }]} accessibilityLabel={`Play ${ep.title}`}>
        <Img source={src(landscapePath(ep, 150))} style={StyleSheet.absoluteFill} />
        <Shape name="cookie9" size={34} color={c.accentContainer} style={styles.epPlay}>
          <Play size={14} color={c.onAccentContainer} fill={c.onAccentContainer} style={{ marginLeft: 2 }} />
        </Shape>
        {ep.userData?.played && <View style={styles.epDone}><Check size={12} color={c.onAccent} strokeWidth={3} /></View>}
        {pct > 0 && <ProgressBar pct={pct} track="rgba(255,255,255,0.35)" style={{ position: 'absolute', left: 8, right: 8, bottom: 6 }} />}
      </Pressable>
      <Pressable onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(ep.id) } })} style={{ flex: 1, paddingVertical: 2 }}>
        <Text style={font.tiny}>
          {ep.seasonNumber === 0 ? 'Special' : 'Episode'} {ep.episodeNumber}{ep.episodeEnd ? `–${ep.episodeEnd}` : ''}{formatRuntime(ep.runtime, ep.duration) ? ` · ${formatRuntime(ep.runtime, ep.duration)}` : ''}
        </Text>
        <Text style={styles.epTitle} numberOfLines={2}>{ep.title}</Text>
        {!!ep.overview && <Text style={styles.epOverview} numberOfLines={2}>{ep.overview}</Text>}
      </Pressable>
      {(user.canDownload || dl) && <DownloadButton itemId={ep.id} compact />}
    </View>
  )
}

function MediaInfo({ item }: { item: ItemDetail }) {
  const { f: font } = useTheme()
  const styles = useStyles()
  const m = item.media!
  const audio = m.streams.filter((s) => s.type === 'audio')
  const subs = [...m.streams.filter((s) => s.type === 'subtitle'), ...(m.sidecars || [])]
  return (
    <View style={{ paddingHorizontal: 16, marginTop: 30 }}>
      <Text style={[font.h2, { fontSize: 20, marginBottom: 12 }]}>File details</Text>
      <View style={styles.info}>
        <InfoRow k="Video" v={`${m.videoCodec.toUpperCase()}${m.videoProfile ? ` (${m.videoProfile})` : ''} · ${m.width}×${m.height}${m.hdr ? ` · ${m.hdr.toUpperCase()}` : ''}`} />
        <InfoRow k="File" v={`${m.container.toUpperCase()} · ${(m.bitrate / 1e6).toFixed(1)} Mbps · ${bytes(m.size)}`} />
        <InfoRow k="Audio" v={audio.map((a) => `${langLabel(a.language)} ${a.codec.toUpperCase()} ${channelLabel(a.channels)}`).join('\n') || 'None'} />
        <InfoRow k="Subtitles" v={subs.map((s) => `${langLabel(s.language)}${s.forced ? ' (Forced)' : ''}${s.external ? ' · External' : ''}`).join(', ') || 'None'} last />
      </View>
    </View>
  )
}

function InfoRow({ k, v, last }: { k: string; v: string; last?: boolean }) {
  const { c, f: font } = useTheme()
  return (
    <View style={[{ flexDirection: 'row', paddingVertical: 14, paddingHorizontal: 16, gap: 12 }, !last && { borderBottomWidth: 2, borderBottomColor: c.bg }]}>
      <Text style={[font.small, { width: 76 }]}>{k}</Text>
      <Text style={[font.body, { flex: 1, fontSize: 14, lineHeight: 20 }]}>{v}</Text>
    </View>
  )
}

const useStyles = makeStyles((c, f) => ({
  series: { ...f.label, color: c.accent, marginBottom: 4 },
  title: { ...f.h1, fontSize: 32, lineHeight: 38, marginBottom: 8 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 18 },
  meta: { ...f.small, color: c.dim, fontWeight: '500' },
  tag: { ...f.labelSmall, fontSize: 11, color: c.onSecondaryContainer, backgroundColor: c.secondaryContainer, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden' },
  tagHdr: { color: c.onTertiaryContainer, backgroundColor: c.tertiaryContainer },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', gap: 2, marginTop: 20, marginBottom: 18 },
  actionLabel: { ...f.labelSmall, marginTop: 6 },
  tagline: { ...f.body, color: c.muted, fontStyle: 'italic', marginBottom: 6, fontSize: 14 },
  overview: { ...f.body, color: c.dim },
  more: { ...f.label, color: c.accent, fontSize: 13 },
  castName: { ...f.label, fontSize: 12.5, textAlign: 'center', marginTop: 8 },
  ep: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 8 },
  epThumb: { width: 136, height: 76, borderRadius: 16, overflow: 'hidden', backgroundColor: c.surface3 },
  epPlay: { position: 'absolute', top: '50%', left: '50%', marginLeft: -17, marginTop: -17 },
  epDone: { position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 7, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
  epTitle: { ...f.bodyStrong, fontSize: 15, marginTop: 2 },
  epOverview: { ...f.tiny, fontSize: 12.5, marginTop: 3, lineHeight: 17 },
  info: { backgroundColor: c.surface2, borderRadius: 24, overflow: 'hidden' },
}))
