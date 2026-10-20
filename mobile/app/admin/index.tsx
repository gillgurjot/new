import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, FolderOpen, Square, Users } from 'lucide-react-native'
import { api, del, errorText } from '../../src/api/client'
import type { PlaySession, SystemInfo } from '../../src/api/types'
import { Card, Header, IconButton, ListRow, ProgressBar, toast } from '../../src/components/ui'
import { formatTime } from '../../src/lib/format'
import { c, font } from '../../src/theme'

function uptime(s: number) {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((s % 3600) / 60)}m`
}

export default function Admin() {
  const qc = useQueryClient()
  const sys = useQuery({ queryKey: ['admin', 'system'], queryFn: () => api<SystemInfo>('/api/admin/system'), refetchInterval: 10_000 })
  const sessions = useQuery({ queryKey: ['admin', 'sessions'], queryFn: () => api<PlaySession[]>('/api/admin/sessions'), refetchInterval: 3_000 })
  const s = sys.data
  const stop = (p: PlaySession) =>
    Alert.alert('Stop this stream?', `${p.username} is watching ${p.title}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop', style: 'destructive',
        onPress: async () => {
          try {
            await del(`/api/admin/sessions/${p.id}`)
            qc.invalidateQueries({ queryKey: ['admin', 'sessions'] })
          } catch (e) {
            toast(errorText(e), 'error')
          }
        },
      },
    ])
  const chevron = <ChevronRight size={18} color={c.muted} />

  return (
    <View style={{ flex: 1 }}>
      <Header title="Server admin" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
        <View style={styles.stats}>
          <Stat label="Movies" value={s?.stats.movie} />
          <Stat label="Shows" value={s?.stats.series} />
          <Stat label="Episodes" value={s?.stats.episode} />
          <Stat label="Users" value={s?.stats.users} />
        </View>

        <Card>
          <ListRow icon={<FolderOpen size={20} color={c.fg} />} title="Libraries" sub="Scan for new files, refresh details" onPress={() => router.push('/admin/libraries')} right={chevron} />
          <View style={styles.sep} />
          <ListRow icon={<Users size={20} color={c.fg} />} title="Users" sub="Library access, downloads, requests" onPress={() => router.push('/admin/users')} right={chevron} />
        </Card>

        <Text style={styles.section}>Watching now</Text>
        <Card>
          {!sessions.data?.length && <Text style={[font.small, { padding: 16 }]}>Nobody is watching right now.</Text>}
          {sessions.data?.map((p, i) => (
            <View key={p.id} style={[{ padding: 14, gap: 6 }, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[font.body, { fontWeight: '600' }]} numberOfLines={1}>{p.title}</Text>
                  <Text style={font.small} numberOfLines={1}>
                    {p.username} · {p.device} · {p.method === 'direct' ? 'Direct' : p.method === 'remux' ? 'Remux' : 'Transcode'}{p.paused ? ' · Paused' : ''}{p.throttled ? ' · Ahead' : ''}
                  </Text>
                </View>
                <IconButton label="Stop stream" size={34} onPress={() => stop(p)} icon={<Square size={14} color={c.danger} fill={c.danger} />} />
              </View>
              <ProgressBar pct={p.duration ? (p.position / p.duration) * 100 : 0} />
              <Text style={font.tiny}>{formatTime(p.position)} / {formatTime(p.duration)}{p.pipeline ? ` · ${p.pipeline}` : ''}</Text>
            </View>
          ))}
        </Card>

        <Text style={styles.section}>Server</Text>
        <Card>
          <Line k="Version" v={s?.version} />
          <Line k="Up for" v={s ? uptime(s.uptime) : ''} />
          <Line k="Encoder" v={s?.hwaccel.description} />
          <Line k="HDR tone mapping" v={s ? (s.hwaccel.hwTonemap ? 'GPU (VAAPI)' : s.hwaccel.swTonemap ? 'CPU' : 'Unavailable') : ''} />
          <Line k="TMDB" v={s ? (s.tmdb ? 'Connected' : 'No API key') : ''} />
          <Line k="Memory" v={s ? `${s.memoryMB} MB` : ''} last />
        </Card>
      </ScrollView>
    </View>
  )
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <View style={styles.stat}>
      <Text style={{ color: c.fg, fontSize: 22, fontWeight: '800' }}>{value ?? '–'}</Text>
      <Text style={font.tiny}>{label}</Text>
    </View>
  )
}

function Line({ k, v, last }: { k: string; v?: string; last?: boolean }) {
  return (
    <View style={[{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12 }, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line }]}>
      <Text style={[font.small, { flex: 1 }]}>{k}</Text>
      <Text style={[font.body, { fontSize: 14, flex: 2, textAlign: 'right' }]} numberOfLines={2}>{v || '–'}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: c.surface, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
  section: { ...font.small, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 12, marginBottom: -6, marginLeft: 4 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: c.line, marginLeft: 54 },
})
