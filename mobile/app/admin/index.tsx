import { Alert, ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, FolderOpen, Link2, RefreshCw, Square, Users } from 'lucide-react-native'
import { api, del, errorText, post } from '../../src/api/client'
import type { JellyfinStatus, PlaySession, SystemInfo } from '../../src/api/types'
import { Button, Group, Header, IconButton, ListRow, ProgressBar, Text, toast } from '../../src/components/ui'
import { ShapeIcon } from '../../src/components/expressive'
import { formatTime, timeAgo } from '../../src/lib/format'
import { makeStyles, useTheme } from '../../src/theme'

function uptime(s: number) {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((s % 3600) / 60)}m`
}

export default function Admin() {
  const qc = useQueryClient()
  const { c, f: font } = useTheme()
  const styles = useStyles()
  const sys = useQuery({ queryKey: ['admin', 'system'], queryFn: () => api<SystemInfo>('/api/admin/system'), refetchInterval: 10_000 })
  const sessions = useQuery({ queryKey: ['admin', 'sessions'], queryFn: () => api<PlaySession[]>('/api/admin/sessions'), refetchInterval: 3_000 })
  const jf = useQuery({ queryKey: ['admin', 'jellyfin'], queryFn: () => api<JellyfinStatus>('/api/admin/jellyfin'), refetchInterval: (q) => (q.state.data?.running ? 2_000 : 30_000) })
  const s = sys.data
  const syncNow = async () => {
    try {
      qc.setQueryData(['admin', 'jellyfin'], await post<JellyfinStatus>('/api/admin/jellyfin/sync'))
      setTimeout(() => qc.invalidateQueries({ queryKey: ['admin', 'jellyfin'] }), 1500)
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }
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
  const chevron = <ChevronRight size={20} color={c.muted} />
  const j = jf.data

  return (
    <View style={{ flex: 1 }}>
      <Header title="Server admin" />
      <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 40 }}>
        <View style={styles.stats}>
          <Stat label="Movies" value={s?.stats.movie} />
          <Stat label="Shows" value={s?.stats.series} />
          <Stat label="Episodes" value={s?.stats.episode} />
          <Stat label="Users" value={s?.stats.users} />
        </View>

        <Group>
          <ListRow icon={FolderOpen} shape="cookie9" title="Libraries" sub="Scan for new files, refresh details" onPress={() => router.push('/admin/libraries')} right={chevron} />
          <ListRow icon={Users} shape="clover4" title="Users" sub="Library access, downloads, requests" onPress={() => router.push('/admin/users')} right={chevron} />
          <ListRow icon={Link2} shape="cookie6" title="Integrations" sub="Connect Jellyfin and Seerr" onPress={() => router.push('/admin/integrations')} right={chevron} />
        </Group>

        <Group title="Jellyfin sync">
          <View style={{ padding: 16, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <ShapeIcon shape="softBurst" icon={RefreshCw} size={44} tone={j?.error ? 'error' : 'tertiary'} spin={j?.running ? 3 : undefined} />
              <View style={{ flex: 1 }}>
                <Text style={[font.bodyStrong, { fontSize: 16 }]}>
                  {!j ? 'Loading…' : !j.enabled ? 'Not set up' : j.running ? 'Syncing…' : j.error ? 'Last sync failed' : j.lastSync ? `Synced ${timeAgo(j.lastSync)}` : 'Waiting for first sync'}
                </Text>
                <Text style={font.small}>
                  {!j?.enabled
                    ? 'Connect Jellyfin under Integrations to carry over watch history, Continue watching, favourites and intro markers.'
                    : j.error || `${j.linked} files linked · ${j.users.length} account${j.users.length === 1 ? '' : 's'} matched`}
                </Text>
              </View>
            </View>
            {!!j?.enabled && (
              <>
                {j.users.length > 0 && <Text style={font.tiny}>{j.users.map((u) => (u.lumen === u.jellyfin ? u.lumen : `${u.lumen} ↔ ${u.jellyfin}`)).join('  ·  ')}</Text>}
                <Text style={font.tiny}>Last run: {j.pulled} updates from Jellyfin, {j.pushed} sent back, {j.segments} intro/credit markers imported.</Text>
                <Button title="Sync now" icon={RefreshCw} variant="tonal" size="s" onPress={syncNow} loading={j.running} style={{ alignSelf: 'flex-start' }} />
              </>
            )}
          </View>
        </Group>

        <Group title="Watching now">
          {!sessions.data?.length ? <Text style={[font.small, { padding: 16 }]}>Nobody is watching right now.</Text> : null}
          {sessions.data?.map((p) => (
            <View key={p.id} style={{ padding: 16, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={font.bodyStrong} numberOfLines={1}>{p.title}</Text>
                  <Text style={font.small} numberOfLines={1}>
                    {p.username} · {p.device} · {p.method === 'direct' ? 'Direct' : p.method === 'remux' ? 'Remux' : 'Transcode'}{p.paused ? ' · Paused' : ''}{p.throttled ? ' · Ahead' : ''}
                  </Text>
                </View>
                <IconButton label="Stop stream" size={40} onPress={() => stop(p)} icon={Square} fill variant="standard" color={c.danger} />
              </View>
              <ProgressBar pct={p.duration ? (p.position / p.duration) * 100 : 0} wavy={!p.paused} />
              <Text style={font.tiny}>{formatTime(p.position)} / {formatTime(p.duration)}{p.pipeline ? ` · ${p.pipeline}` : ''}</Text>
            </View>
          ))}
        </Group>

        <Group title="Server">
          <Line k="Version" v={s?.version} />
          <Line k="Up for" v={s ? uptime(s.uptime) : ''} />
          <Line k="Encoder" v={s?.hwaccel.description} />
          <Line k="HDR tone mapping" v={s ? (s.hwaccel.hwTonemap ? 'GPU (VAAPI)' : s.hwaccel.swTonemap ? 'CPU' : 'Unavailable') : ''} />
          <Line k="TMDB" v={s ? (s.tmdb ? 'Connected' : 'No API key') : ''} />
          <Line k="Memory" v={s ? `${s.memoryMB} MB` : ''} />
        </Group>
      </ScrollView>
    </View>
  )
}

function Stat({ label, value }: { label: string; value?: number }) {
  const styles = useStyles()
  const { c, f } = useTheme()
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value ?? '–'}</Text>
      <Text style={[f.labelSmall, { color: c.onAccentContainer }]}>{label}</Text>
    </View>
  )
}

function Line({ k, v }: { k: string; v?: string }) {
  const { f } = useTheme()
  return (
    <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 14 }}>
      <Text style={[f.small, { flex: 1 }]}>{k}</Text>
      <Text style={[f.body, { fontSize: 14, flex: 2, textAlign: 'right' }]} numberOfLines={2}>{v || '–'}</Text>
    </View>
  )
}

const useStyles = makeStyles((c, f) => ({
  stats: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 20 },
  stat: { flex: 1, backgroundColor: c.accentContainer, borderRadius: 24, paddingVertical: 16, alignItems: 'center' },
  statValue: { ...f.h2, color: c.onAccentContainer },
}))
