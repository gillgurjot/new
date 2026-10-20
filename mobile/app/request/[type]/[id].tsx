import { useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LinearGradient } from 'expo-linear-gradient'
import { Check, CircleCheck, ExternalLink, Play, Plus, Star } from 'lucide-react-native'
import { api, errorText, post, src, tmdbPath } from '../../../src/api/client'
import type { RequestDetails, RequestSeason } from '../../../src/api/types'
import { statusInfo } from '../../../src/components/cards'
import { Button, Header, Img, Loading, toast } from '../../../src/components/ui'
import { formatRuntime } from '../../../src/lib/format'
import { useRequestsConfig } from '../../../src/lib/queries'
import { c, font, radius } from '../../../src/theme'

export default function RequestScreen() {
  const { type, id } = useLocalSearchParams<{ type: 'movie' | 'tv'; id: string }>()
  const { width } = useWindowDimensions()
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
  const st = statusInfo[t.status]

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
                <Text style={styles.statusText}>{st.label}</Text>
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
                const sst = statusInfo[s.status]
                const selectable = s.status === 'none' && canRequest
                const on = picked.includes(s.seasonNumber)
                return (
                  <Pressable key={s.seasonNumber} disabled={!selectable} onPress={() => togglePick(s)} style={[styles.season, on && { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
                    <View style={[styles.box, on && { backgroundColor: c.white, borderColor: c.white }, !selectable && { borderColor: 'transparent' }]}>
                      {on && <Check size={14} color={c.black} strokeWidth={3} />}
                      {!selectable && s.status !== 'none' && <CircleCheck size={16} color="rgba(255,255,255,0.4)" />}
                    </View>
                    <Text style={[font.body, { flex: 1, fontWeight: '500' }]} numberOfLines={1}>{s.name || `Season ${s.seasonNumber}`}</Text>
                    <Text style={font.tiny}>{s.episodeCount} ep</Text>
                    {!!sst.label && <View style={[styles.status, { backgroundColor: sst.bg, marginTop: 0 }]}><Text style={styles.statusText}>{sst.label}</Text></View>}
                  </Pressable>
                )
              })}
              {open.length > 0 && canRequest && <Text style={[font.tiny, { marginTop: 6 }]}>Pick seasons, or leave them all unticked to request everything that’s missing.</Text>}
            </View>
          )}

          <View style={{ gap: 10, marginTop: 24 }}>
            {!!t.itemId && <Button variant="primary" title="Watch now" icon={<Play size={18} color={c.black} fill={c.black} />} onPress={() => router.push({ pathname: '/item/[id]', params: { id: String(t.itemId) } })} />}
            {canAsk ? (
              <Button variant={t.itemId ? 'ghost' : 'accent'} title={label} icon={<Plus size={18} color={c.white} />} onPress={send} loading={busy} />
            ) : !t.itemId && t.status !== 'none' ? (
              <View style={styles.info}>
                <Text style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center' }}>
                  {t.status === 'pending' ? 'Requested — waiting for approval' : t.status === 'processing' ? 'Requested — downloading' : t.status === 'available' ? 'Available — the library will update shortly' : 'Partly available'}
                </Text>
              </View>
            ) : null}
            {!!cfg.data?.seerrUrl && <Button title="Open in Seerr" icon={<ExternalLink size={16} color={c.fg} />} onPress={() => Linking.openURL(`${cfg.data!.seerrUrl}/${t.mediaType}/${t.tmdbId}`)} />}
          </View>
        </View>
      </ScrollView>
      <Header transparent />
    </View>
  )
}

const styles = StyleSheet.create({
  poster: { width: 104, height: 156, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)' },
  overview: { color: 'rgba(255,255,255,0.82)', fontSize: 15, lineHeight: 22, marginTop: 12 },
  eyebrow: { color: c.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  season: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, height: 50, borderRadius: 12 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  status: { alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 6, height: 20, borderRadius: 6, justifyContent: 'center' },
  statusText: { fontSize: 10, fontWeight: '800', color: c.black, textTransform: 'uppercase', letterSpacing: 0.3 },
  info: { minHeight: 46, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
})
