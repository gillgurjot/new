import { useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LinearGradient } from 'expo-linear-gradient'
import { Check, CircleCheck, ExternalLink, Info, Play, Plus, Star } from 'lucide-react-native'
import { api, errorText, post, src, tmdbPath } from '../../../src/api/client'
import type { RequestDetails, RequestSeason } from '../../../src/api/types'
import { statusInfo } from '../../../src/components/cards'
import { Button, Header, Img, Loading, Text, toast } from '../../../src/components/ui'
import { formatRuntime } from '../../../src/lib/format'
import { useRequestsConfig } from '../../../src/lib/queries'
import { makeStyles, useTheme } from '../../../src/theme'

export default function RequestScreen() {
  const { type, id } = useLocalSearchParams<{ type: 'movie' | 'tv'; id: string }>()
  const { width } = useWindowDimensions()
  const { c, f: font } = useTheme()
  const styles = useStyles()
  const qc = useQueryClient()
  const cfg = useRequestsConfig()
  const canRequest = !!cfg.data?.canRequest
  const d = useQuery({ queryKey: ['request-title', type, Number(id)], queryFn: () => api<RequestDetails>(`/api/requests/title/${type}/${id}`), retry: false })
  const [picked, setPicked] = useState<number[]>([])
  const [busy, setBusy] = useState(false)

  if (d.isLoading) return <View style={{ flex: 1 }}><Header /><Loading /></View>
  if (!d.data) return <View style={{ flex: 1 }}><Header /><Text style={[font.body, { textAlign: 'center', marginTop: 60, color: c.muted }]}>{errorText(d.error, 'Couldn’t load this title')}</Text></View>

  const t = d.data.title
  const seasons = d.data.seasons || []
  const open = seasons.filter((s) => s.status === 'none')
  const isTV = t.mediaType === 'tv'
  const canAsk = canRequest && (isTV ? open.length > 0 : t.status === 'none')
  const st = statusInfo(c, t.status)

  const send = async () => {
    setBusy(true)
    try {
      const all = isTV && (picked.length === 0 || picked.length === open.length) && open.length === seasons.length
      await post('/api/requests', { mediaType: t.mediaType, tmdbId: t.tmdbId, seasons: isTV ? (all ? [] : picked.length ? picked : open.map((s) => s.seasonNumber)) : undefined })
      toast(`Requested ${t.title}`)
      qc.invalidateQueries({ queryKey: ['requests'] })
      qc.invalidateQueries({ queryKey: ['request-title', t.mediaType, t.tmdbId] })
      setPicked([])
    } catch (e) {
      toast(errorText(e, 'Request failed'), 'error')
    } finally {
      setBusy(false)
    }
  }
  const togglePick = (s: RequestSeason) => setPicked((p) => (p.includes(s.seasonNumber) ? p.filter((x) => x !== s.seasonNumber) : [...p, s.seasonNumber]))
  const label = isTV ? (picked.length && picked.length < open.length ? `Request ${picked.length} season${picked.length > 1 ? 's' : ''}` : open.length === seasons.length ? 'Request all seasons' : 'Request missing seasons') : 'Request'

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ height: width * 0.6 }}>
          <Img source={src(tmdbPath(t.backdrop, 'w1280'))} style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['transparent', c.bg]} style={StyleSheet.absoluteFill} />
        </View>
        <View style={{ flexDirection: 'row', gap: 14, paddingHorizontal: 16, marginTop: -70 }}>
          <Img source={src(tmdbPath(t.poster, 'w342'))} style={styles.poster} />
          <View style={{ flex: 1, paddingTop: 54 }}>
            <Text style={font.h2}>{t.title}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              <Text style={font.small}>{[t.year, isTV ? 'Show' : 'Movie', d.data.runtime ? formatRuntime(d.data.runtime) : ''].filter(Boolean).join(' · ')}</Text>
              {!!t.rating && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Star size={12} color={c.warn} fill={c.warn} />
                  <Text style={font.small}>{t.rating.toFixed(1)}</Text>
                </View>
              )}
            </View>
            {!!st.label && (
              <View style={[styles.status, { backgroundColor: st.bg }]}>
                {st.Icon && <st.Icon size={12} color={st.fg} strokeWidth={2.75} />}
                <Text style={[styles.statusText, { color: st.fg }]}>{st.label}</Text>
              </View>
            )}
          </View>
        </View>
        <View style={{ paddingHorizontal: 16 }}>
          {!!d.data.genres?.length && <Text style={[font.small, { marginTop: 14 }]}>{d.data.genres.join(' · ')}</Text>}
          {!!t.overview && <Text style={styles.overview}>{t.overview}</Text>}

          {isTV && seasons.length > 0 && (
            <View style={{ marginTop: 20 }}>
              <Text style={styles.eyebrow}>Seasons</Text>
              {seasons.map((s) => {
                const sst = statusInfo(c, s.status)
                const selectable = s.status === 'none' && canRequest
                const on = picked.includes(s.seasonNumber)
                return (
                  <Pressable key={s.seasonNumber} disabled={!selectable} onPress={() => togglePick(s)} style={[styles.season, on && { backgroundColor: c.secondaryContainer }]}>
                    <View style={[styles.box, on && { backgroundColor: c.accent, borderColor: c.accent }, !selectable && { borderColor: 'transparent' }]}>
                      {on && <Check size={14} color={c.onAccent} strokeWidth={3} />}
                      {!selectable && s.status !== 'none' && <CircleCheck size={18} color={c.muted} />}
                    </View>
                    <Text style={[font.body, { flex: 1, fontWeight: '500' }]} numberOfLines={1}>{s.name || `Season ${s.seasonNumber}`}</Text>
                    <Text style={font.tiny}>{s.episodeCount} ep</Text>
                    {!!sst.label && <View style={[styles.status, { backgroundColor: sst.bg, marginTop: 0 }]}><Text style={[styles.statusText, { color: sst.fg }]}>{sst.label}</Text></View>}
                  </Pressable>
                )
              })}
              {open.length > 0 && canRequest && <Text style={[font.tiny, { marginTop: 6 }]}>Pick seasons, or leave them all unticked to request everything that’s missing.</Text>}
            </View>
          )}

          <View style={{ gap: 10, marginTop: 24 }}>
            {!!t.itemId && <Button variant="filled" size="l" title="Watch now" icon={Play} iconFill onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(t.itemId) } })} />}
            {canAsk ? (
              <Button variant={t.itemId ? 'tonal' : 'filled'} size="l" title={label} icon={Plus} onPress={send} loading={busy} />
            ) : !t.itemId && t.status !== 'none' ? (
              <View style={styles.info}>
                <Info size={18} color={c.onSecondaryContainer} />
                <Text style={[font.label, { color: c.onSecondaryContainer, flexShrink: 1 }]}>
                  {t.status === 'pending' ? 'Requested — waiting for approval' : t.status === 'processing' ? 'Requested — downloading' : t.status === 'available' ? 'Available — the library will update shortly' : 'Partly available'}
                </Text>
              </View>
            ) : null}
            {!!cfg.data?.seerrUrl && <Button variant="outlined" title="Open in Seerr" icon={ExternalLink} onPress={() => Linking.openURL(`${cfg.data!.seerrUrl}/${t.mediaType}/${t.tmdbId}`)} />}
          </View>
        </View>
      </ScrollView>
      <Header transparent />
    </View>
  )
}

const useStyles = makeStyles((c, f) => ({
  poster: { width: 108, height: 162, borderRadius: 16 },
  overview: { ...f.body, color: c.dim, marginTop: 12 },
  eyebrow: { ...f.label, color: c.accent, marginBottom: 8 },
  season: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, height: 52, borderRadius: 26 },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: c.outline, alignItems: 'center', justifyContent: 'center' },
  status: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, paddingHorizontal: 9, height: 24, borderRadius: 12 },
  statusText: { ...f.labelSmall, fontSize: 11 },
  info: { minHeight: 52, borderRadius: 26, backgroundColor: c.secondaryContainer, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 18 },
}))
