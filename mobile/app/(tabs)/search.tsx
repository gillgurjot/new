import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Search as SearchIcon, Sparkles, X } from 'lucide-react-native'
import { api, landscapePath, src } from '../../src/api/client'
import type { Item } from '../../src/api/types'
import Grid from '../../src/components/Grid'
import { openItem } from '../../src/components/cards'
import { Chip, EmptyState, Img, Loading } from '../../src/components/ui'
import { episodeLabel } from '../../src/lib/format'
import { useLibraries, useRequestsConfig } from '../../src/lib/queries'
import { c, font, radius } from '../../src/theme'

export default function Search() {
  const insets = useSafeAreaInsets()
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
      <View style={styles.box}>
        <SearchIcon size={18} color={c.muted} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Movies, shows, episodes"
          placeholderTextColor={c.muted}
          style={styles.input}
          returnKeyType="search"
          autoCorrect={false}
        />
        {!!text && (
          <Pressable onPress={() => setText('')} hitSlop={10} accessibilityLabel="Clear">
            <X size={18} color={c.muted} />
          </Pressable>
        )}
      </View>
      {!q && (
        <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
          <Text style={[font.small, { marginBottom: 10 }]}>Browse</Text>
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
                <Img source={src(landscapePath(e, 200))} style={{ width: 200, height: 112, borderRadius: radius.md }} />
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
            <EmptyState icon={<SearchIcon size={26} color={c.muted} />} title={`Nothing found for “${q}”`}>
              {req.data?.enabled ? 'Not in the library yet? You can request it.' : 'Try a different spelling.'}
            </EmptyState>
          ) : null
        }
        footer={
          q && req.data?.enabled ? (
            <Pressable onPress={() => router.navigate({ pathname: '/requests', params: { q } })} style={styles.request}>
              <Sparkles size={18} color={c.accent} />
              <Text style={[font.body, { flex: 1 }]}>Request “{q}”</Text>
            </Pressable>
          ) : null
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 18, height: 48, borderRadius: radius.pill, backgroundColor: c.surface2, paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
  input: { flex: 1, color: c.fg, fontSize: 16, paddingVertical: 0 },
  epTitle: { color: c.fg, fontSize: 13, fontWeight: '600', marginTop: 6 },
  request: { flexDirection: 'row', alignItems: 'center', gap: 12, margin: 16, padding: 16, borderRadius: radius.lg, backgroundColor: c.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: c.line },
})
