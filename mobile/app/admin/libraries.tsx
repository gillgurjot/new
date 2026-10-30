import { ScrollView, View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Film, RefreshCw, ScanSearch, Tv } from 'lucide-react-native'
import { api, errorText, post } from '../../src/api/client'
import type { Library, ScanStatus } from '../../src/api/types'
import { Button, Card, Header, Loading, ProgressBar, Text, toast } from '../../src/components/ui'
import { ShapeIcon } from '../../src/components/expressive'
import { plural, timeAgo } from '../../src/lib/format'
import { makeStyles, useTheme } from '../../src/theme'

export default function AdminLibraries() {
  const qc = useQueryClient()
  const { f: font } = useTheme()
  const styles = useStyles()
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
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}>
          {q.data?.libraries.map((l) => {
            const scan = q.data.scans?.find((s) => s.libraryId === l.id && s.running)
            const Icon = l.type === 'tv' ? Tv : Film
            return (
              <Card key={l.id} style={{ padding: 18, gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <ShapeIcon shape={l.type === 'tv' ? 'cookie9' : 'clover4'} icon={Icon} size={44} tone="primary" />
                  <View style={{ flex: 1 }}>
                    <Text style={font.h3}>{l.name}</Text>
                    <Text style={font.small}>{plural(l.itemCount, 'title')} · scanned {timeAgo(l.lastScan)}</Text>
                  </View>
                </View>
                {(l.paths || []).map((p) => <Text key={p} style={styles.path} numberOfLines={1}>{p}</Text>)}
                {scan ? (
                  <View style={{ gap: 6 }}>
                    <Text style={font.small}>{scan.phase} · {scan.done}/{scan.total}{scan.added ? ` · ${scan.added} new` : ''}</Text>
                    <ProgressBar pct={scan.total ? (scan.done / scan.total) * 100 : 5} wavy />
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button size="s" title="Scan" icon={ScanSearch} onPress={() => act(`/api/admin/libraries/${l.id}/scan`, `Scanning ${l.name}`)} style={{ flex: 1 }} />
                    <Button size="s" variant="outlined" title="Refresh details" icon={RefreshCw} onPress={() => act(`/api/admin/libraries/${l.id}/refresh`, `Refreshing ${l.name}`)} style={{ flex: 1 }} />
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

const useStyles = makeStyles((c, f) => ({
  path: { ...f.tiny, fontFamily: 'monospace' },
}))
