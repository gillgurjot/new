import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronRight, Search as SearchIcon, Sparkles } from 'lucide-react-native'
import { api, landscapePath, src } from '../../src/api/client'
import type { Item } from '../../src/api/types'
import Grid from '../../src/components/Grid'
import { openItem } from '../../src/components/cards'
import { Chip, EmptyState, Img, ListRow, Loading, SearchBar, Text } from '../../src/components/ui'
import { episodeLabel } from '../../src/lib/format'
import { useLibraries, useRequestsConfig } from '../../src/lib/queries'
import { makeStyles, useTheme } from '../../src/theme'

export default function Search() {
  const insets = useSafeAreaInsets()
  const { c, f: font } = useTheme()
  const styles = useStyles()
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const libs = useLibraries()
  const req = useRequestsConfig()

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250)
    return () => clearTimeout(t)
  }, [text])

  const r = useQuery({ queryKey: ['search', q], queryFn: () => api<Item[]>(`/api/search?q=${encodeURIComponent(q)}`), enabled: q.length > 0, placeholderData: keepPreviousData })
  const titles = useMemo(() => (r.data || []).filter((i) => i.type !== 'episode'), [r.data])
  const episodes = useMemo(() => (r.data || []).filter((i) => i.type === 'episode'), [r.data])

  const header = (
    <View style={{ paddingTop: insets.top + 10 }}>
      <SearchBar value={text} onChangeText={setText} onClear={() => setText('')} placeholder="Movies, shows, episodes" style={{ marginHorizontal: 16, marginBottom: 18 }} />
      {!q && (
        <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
          <Text style={[font.label, { color: c.accent, marginBottom: 10 }]}>Browse</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(libs.data || []).map((l) => (
              <Chip key={l.id} label={l.name} onPress={() => router.push({ pathname: '/library/[id]', params: { id: String(l.id) } })} />
            ))}
          </View>
        </View>
      )}
      {!!q && episodes.length > 0 && (
        <View style={{ marginBottom: 16 }}>
          <Text style={[font.h3, { paddingHorizontal: 16, marginBottom: 10 }]}>Episodes</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 16 }}>
            {episodes.slice(0, 20).map((e) => (
              <Pressable key={e.id} onPress={() => openItem(e)} style={{ width: 200 }}>
                <Img source={src(landscapePath(e, 200))} style={{ width: 200, height: 112, borderRadius: 16 }} />
                <Text style={styles.epTitle} numberOfLines={1}>{e.title}</Text>
                <Text style={font.tiny} numberOfLines={1}>{e.seriesTitle} · {episodeLabel(e)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
      {!!q && titles.length > 0 && <Text style={[font.h3, { paddingHorizontal: 16, marginBottom: 10 }]}>Movies & shows</Text>}
    </View>
  )

  return (
    <View style={{ flex: 1 }}>
      <Grid
        items={q ? titles : []}
        header={header}
        empty={
          q && r.isFetching && !r.data ? (
            <Loading />
          ) : q && !r.isFetching && !episodes.length ? (
            <EmptyState icon={SearchIcon} shape="pentagon" title={`Nothing found for “${q}”`}>
              {req.data?.enabled ? 'Not in the library yet? You can request it.' : 'Try a different spelling.'}
            </EmptyState>
          ) : null
        }
        footer={
          q && req.data?.enabled ? (
            <View style={styles.request}>
              <ListRow icon={Sparkles} shape="sunny" tone="tertiary" title={`Request “${q}”`} sub="Ask for it to be added to the library" onPress={() => router.navigate({ pathname: '/requests', params: { q } })} right={<ChevronRight size={20} color={c.muted} />} />
            </View>
          ) : null
        }
      />
    </View>
  )
}

const useStyles = makeStyles((c, f) => ({
  epTitle: { ...f.label, fontSize: 13.5, marginTop: 8 },
  request: { margin: 16, borderRadius: 24, overflow: 'hidden', backgroundColor: c.surface2 },
}))
