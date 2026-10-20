import { useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ArrowDownUp, ChevronDown, Shuffle } from 'lucide-react-native'
import { api } from '../../src/api/client'
import type { Item } from '../../src/api/types'
import Grid from '../../src/components/Grid'
import { Chip, EmptyState, Header, IconButton, Loading, MenuSheet, Meta } from '../../src/components/ui'
import { plural } from '../../src/lib/format'
import { useLibraries } from '../../src/lib/queries'
import { c } from '../../src/theme'

const PAGE = 60
const sorts = [
  { v: 'title', l: 'Title' },
  { v: 'added', l: 'Date added' },
  { v: 'year', l: 'Release year' },
  { v: 'rating', l: 'Rating' },
  { v: 'runtime', l: 'Runtime' },
  { v: 'played', l: 'Last watched' },
]
const playedOpts = [
  { v: '', l: 'All' },
  { v: 'unplayed', l: 'Unwatched' },
  { v: 'played', l: 'Watched' },
]

export default function Library() {
  const params = useLocalSearchParams<{ id: string; sort?: string }>()
  const id = params.id
  const libs = useLibraries()
  const lib = libs.data?.find((l) => String(l.id) === id)
  const [sort, setSort] = useState(params.sort || 'title')
  const [order, setOrder] = useState<'asc' | 'desc'>(params.sort && params.sort !== 'title' ? 'desc' : 'asc')
  const [genre, setGenre] = useState('')
  const [played, setPlayed] = useState('')
  const [menu, setMenu] = useState<null | 'sort' | 'genre' | 'played'>(null)

  const genres = useQuery({ queryKey: ['genres', id], queryFn: () => api<string[]>(`/api/libraries/${id}/genres`), staleTime: 300_000 })
  const qs = useMemo(() => new URLSearchParams({ sort, order, genre, played, limit: String(PAGE) }).toString(), [sort, order, genre, played])
  const q = useInfiniteQuery({
    queryKey: ['library', id, qs],
    queryFn: ({ pageParam }) => api<{ items: Item[]; total: number }>(`/api/libraries/${id}/items?${qs}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last, all) => {
      const n = all.reduce((a, p) => a + p.items.length, 0)
      return n < last.total ? n : undefined
    },
  })
  const items = q.data?.pages.flatMap((p) => p.items) || []
  const total = q.data?.pages[0]?.total ?? 0

  const shuffle = async () => {
    const r = await api<{ items: Item[] }>(`/api/libraries/${id}/items?sort=random&limit=1`).catch(() => null)
    if (r?.items[0]) router.push({ pathname: '/item/[id]', params: { id: String(r.items[0].id) } })
  }

  const filters = (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 12 }}>
        <Chip label={sorts.find((s) => s.v === sort)?.l || 'Sort'} icon={<ArrowDownUp size={14} color={c.fg} />} onPress={() => setMenu('sort')} />
        <Chip label={genre || 'All genres'} active={!!genre} icon={<ChevronDown size={14} color={genre ? c.black : c.fg} />} onPress={() => setMenu('genre')} />
        <Chip label={playedOpts.find((p) => p.v === played)?.l || 'All'} active={!!played} onPress={() => setMenu('played')} />
      </ScrollView>
      <Meta items={[q.data ? plural(total, 'title') : '']} style={{ paddingHorizontal: 16, marginBottom: 12 }} />
    </View>
  )

  return (
    <View style={{ flex: 1 }}>
      <Header title={lib?.name || 'Library'} right={<IconButton label="Shuffle" onPress={shuffle} icon={<Shuffle size={18} color={c.fg} />} />} />
      {q.isLoading ? (
        <Loading />
      ) : (
        <Grid
          items={items}
          header={filters}
          onEnd={() => q.hasNextPage && !q.isFetchingNextPage && q.fetchNextPage()}
          footer={q.isFetchingNextPage ? <ActivityIndicator color={c.accent} style={{ margin: 20 }} /> : null}
          empty={<EmptyState title="No titles match">Try clearing a filter.</EmptyState>}
        />
      )}
      <MenuSheet
        open={menu === 'sort'}
        onClose={() => setMenu(null)}
        title="Sort by"
        options={[
          ...sorts.map((s) => ({
            label: s.l,
            selected: s.v === sort,
            onPress: () => {
              setSort(s.v)
              setOrder(s.v === 'title' ? 'asc' : 'desc')
            },
          })),
          { label: order === 'asc' ? 'Ascending (tap to reverse)' : 'Descending (tap to reverse)', icon: <ArrowDownUp size={16} color={c.muted} />, onPress: () => setOrder(order === 'asc' ? 'desc' : 'asc') },
        ]}
      />
      <MenuSheet
        open={menu === 'genre'}
        onClose={() => setMenu(null)}
        title="Genre"
        options={[{ label: 'All genres', selected: !genre, onPress: () => setGenre('') }, ...(genres.data || []).map((g) => ({ label: g, selected: g === genre, onPress: () => setGenre(g) }))]}
      />
      <MenuSheet open={menu === 'played'} onClose={() => setMenu(null)} title="Show" options={playedOpts.map((p) => ({ label: p.l, selected: p.v === played, onPress: () => setPlayed(p.v) }))} />
    </View>
  )
}
