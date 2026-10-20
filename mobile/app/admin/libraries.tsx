import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Film, RefreshCw, ScanSearch, Tv } from 'lucide-react-native'
import { api, errorText, post } from '../../src/api/client'
import type { Library, ScanStatus } from '../../src/api/types'
import { Button, Card, Header, Loading, ProgressBar, toast } from '../../src/components/ui'
import { plural, timeAgo } from '../../src/lib/format'
import { c, font } from '../../src/theme'

export default function AdminLibraries() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['admin', 'libraries'],
    queryFn: () => api<{ libraries: Library[]; scans: ScanStatus[] }>('/api/admin/libraries'),
    refetchInterval: (query) => (query.state.data?.scans?.some((s) => s.running) ? 1500 : 10_000),
  })
  const act = async (path: string, msg: string) => {
    try {
      await post(path)
      toast(msg, 'info')
      qc.invalidateQueries({ queryKey: ['admin', 'libraries'] })
    } catch (e) {
      toast(errorText(e), 'error')
    }
  }
  return (
    <View style={{ flex: 1 }}>
      <Header title="Libraries" />
      {q.isLoading ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}>
          {q.data?.libraries.map((l) => {
            const scan = q.data.scans?.find((s) => s.libraryId === l.id && s.running)
            const Icon = l.type === 'tv' ? Tv : Film
            return (
              <Card key={l.id} style={{ padding: 16, gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={styles.icon}><Icon size={20} color={c.accent} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={font.h3}>{l.name}</Text>
                    <Text style={font.small}>{plural(l.itemCount, 'title')} · scanned {timeAgo(l.lastScan)}</Text>
                  </View>
                </View>
                {(l.paths || []).map((p) => <Text key={p} style={styles.path} numberOfLines={1}>{p}</Text>)}
                {scan ? (
                  <View style={{ gap: 6 }}>
                    <Text style={font.small}>{scan.phase} · {scan.done}/{scan.total}{scan.added ? ` · ${scan.added} new` : ''}</Text>
                    <ProgressBar pct={scan.total ? (scan.done / scan.total) * 100 : 5} />
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button small title="Scan for new files" icon={<ScanSearch size={16} color={c.fg} />} onPress={() => act(`/api/admin/libraries/${l.id}/scan`, `Scanning ${l.name}`)} style={{ flex: 1 }} />
                    <Button small title="Refresh details" icon={<RefreshCw size={15} color={c.fg} />} onPress={() => act(`/api/admin/libraries/${l.id}/refresh`, `Refreshing ${l.name}`)} style={{ flex: 1 }} />
                  </View>
                )}
              </Card>
            )
          })}
          <Text style={[font.tiny, { textAlign: 'center', marginTop: 8 }]}>Add or remove libraries from the website.</Text>
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(157,140,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  path: { color: c.muted, fontSize: 12, fontFamily: 'monospace' },
})
