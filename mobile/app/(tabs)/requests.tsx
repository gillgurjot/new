import { useEffect, useMemo, useState } from 'react'
import { FlatList, ScrollView, View, useWindowDimensions } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Search, Sparkles, TriangleAlert } from 'lucide-react-native'
import { api } from '../../src/api/client'
import type { RecentRequest, RequestTitle } from '../../src/api/types'
import { RequestCard, openRequest } from '../../src/components/cards'
import { Chip, EmptyState, Loading, PageTitle, SearchBar, Text } from '../../src/components/ui'
import { LoadingIndicator } from '../../src/components/expressive'
import { timeAgo } from '../../src/lib/format'
import { useRequestsConfig } from '../../src/lib/queries'
import { makeStyles, useTheme } from '../../src/theme'

type Page = { results: RequestTitle[]; page: number; totalPages: number }

const lists = [
  { v: 'trending', l: 'Trending' },
  { v: 'movies', l: 'Popular movies' },
  { v: 'tv', l: 'Popular shows' },
  { v: 'upcoming', l: 'Coming soon' },
]

export default function Requests() {
  const insets = useSafeAreaInsets()
  const { c, f: font } = useTheme()
  const styles = useStyles()
  const params = useLocalSearchParams<{ q?: string }>()
  const { width } = useWindowDimensions()
  const cfg = useRequestsConfig()
  const [text, setText] = useState(params.q || '')
  const [q, setQ] = useState(text.trim())
  const [list, setList] = useState('trending')
  useEffect(() => {
    if (params.q) setText(params.q)
  }, [params.q])
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300)
    return () => clearTimeout(t)
  }, [text])

  const enabled = !!cfg.data?.enabled
  const browse = useInfiniteQuery({
    queryKey: ['requests', q ? 'search' : list, q],
    queryFn: ({ pageParam }) => api<Page>(q ? `/api/requests/search?q=${encodeURIComponent(q)}&page=${pageParam}` : `/api/requests/discover/${list}?page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages && last.page < 20 ? last.page + 1 : undefined),
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  })
  const recent = useQuery({ queryKey: ['requests', 'recent'], queryFn: () => api<RecentRequest[]>('/api/requests/recent'), enabled, retry: false })
  const results = useMemo(() => {
    const seen = new Set<string>()
    return (browse.data?.pages.flatMap((p) => p.results) || []).filter((t) => {
      const k = t.mediaType + t.tmdbId
      return seen.has(k) ? false : (seen.add(k), true)
    })
  }, [browse.data])

  const cols = Math.max(3, Math.floor((width - 16) / 140))
  const w = Math.floor((width - 32 - 12 * (cols - 1)) / cols)

  if (cfg.isLoading) return <Loading />
  if (!enabled) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <EmptyState icon={Sparkles} shape="sunny" title="Requests aren’t set up">An admin can connect Seerr on the server.</EmptyState>
      </View>
    )
  }

  const header = (
    <View style={{ paddingTop: insets.top + 16 }}>
      <View style={{ paddingHorizontal: 16 }}>
        <PageTitle sub="Find a movie or show and request it. It’s downloaded and added to the library automatically.">Request</PageTitle>
        {!cfg.data?.canRequest && (
          <View style={styles.warn}>
            <TriangleAlert size={18} color={c.onTertiaryContainer} />
            <Text style={styles.warnText}>Requests are turned off for your account. You can still browse.</Text>
          </View>
        )}
        <SearchBar value={text} onChangeText={setText} onClear={() => setText('')} placeholder="Search every movie and show" style={{ marginBottom: 20 }} />
      </View>
      {!q && (recent.data?.length || 0) > 0 && (
        <View style={{ marginBottom: 20 }}>
          <Text style={[font.label, { color: c.accent, paddingHorizontal: 20, marginBottom: 10 }]}>Recent requests</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 16 }}>
            {recent.data!.map((r) => {
              const status = r.status === 'available' ? 'available' : r.status === 'approved' ? 'processing' : r.status === 'pending' ? 'pending' : r.title.status
              return (
                <View key={r.id} style={{ width: 110 }}>
                  <RequestCard t={{ ...r.title, status }} width={110} onPress={() => openRequest(r.title)} />
                  <Text style={[font.tiny, { marginTop: 1 }]} numberOfLines={1}>{r.status === 'declined' ? 'Declined' : r.status === 'failed' ? 'Failed' : r.requestedBy} · {timeAgo(Date.parse(r.createdAt) / 1000)}</Text>
                </View>
              )
            })}
          </ScrollView>
        </View>
      )}
      {!q && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, marginBottom: 16 }}>
          {lists.map((x) => <Chip key={x.v} label={x.l} active={list === x.v} onPress={() => setList(x.v)} />)}
        </ScrollView>
      )}
      {!!browse.error && (
        <View style={[styles.warn, { marginHorizontal: 16 }]}>
          <TriangleAlert size={18} color={c.onTertiaryContainer} />
          <Text style={styles.warnText}>{(browse.error as Error).message}</Text>
        </View>
      )}
    </View>
  )

  return (
    <FlatList
      key={cols}
      data={results}
      numColumns={cols}
      keyExtractor={(t) => t.mediaType + t.tmdbId}
      ListHeaderComponent={header}
      columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
      contentContainerStyle={{ gap: 16, paddingBottom: 40 }}
      renderItem={({ item }) => <RequestCard t={item} width={w} onPress={() => openRequest(item)} />}
      onEndReached={() => browse.hasNextPage && !browse.isFetchingNextPage && browse.fetchNextPage()}
      onEndReachedThreshold={1.5}
      ListEmptyComponent={
        (browse.isLoading ? <Loading /> : q && browse.data ? <EmptyState icon={Search} shape="pentagon" title={`Nothing found for “${q}”`}>Try the original title or fewer words.</EmptyState> : null) ?? undefined
      }
      ListFooterComponent={browse.isFetchingNextPage ? <View style={{ alignItems: 'center', margin: 20 }}><LoadingIndicator size={40} /></View> : undefined}
    />
  )
}

const useStyles = makeStyles((c, f) => ({
  warn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.tertiaryContainer, borderRadius: 20, padding: 14, marginBottom: 14 },
  warnText: { ...f.small, color: c.onTertiaryContainer, flex: 1 },
}))
