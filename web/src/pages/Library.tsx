import { useEffect, useMemo, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown, Filter, Shuffle } from 'lucide-react'
import { ApiError, api } from '../api/client'
import type { Item } from '../api/types'
import { CardSkeleton, PosterCard } from '../components/Cards'
import { useLibraries } from '../components/Layout'
import { EmptyState, PageTitle, toast } from '../components/ui'
import { plural } from '../lib/format'
import { useNavigate } from 'react-router-dom'

const PAGE = 60
const sorts = [
  { v: 'title', l: 'Title' },
  { v: 'added', l: 'Date added' },
  { v: 'year', l: 'Release year' },
  { v: 'rating', l: 'Rating' },
  { v: 'runtime', l: 'Runtime' },
  { v: 'played', l: 'Last watched' },
]
const letters = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

export default function LibraryPage() {
  const { id } = useParams()
  const [sp, setSp] = useSearchParams()
  const libs = useLibraries()
  const nav = useNavigate()
  const lib = libs.data?.find((l) => String(l.id) === id)
  const sort = sp.get('sort') || 'title'
  const order = sp.get('order') || (sort === 'title' ? 'asc' : 'desc')
  const genre = sp.get('genre') || ''
  const played = sp.get('played') || ''
  // The A–Z bar only shows when sorting by title, so the letter only applies then too.
  const letter = sort === 'title' ? sp.get('letter') || '' : ''
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp)
    if (v) n.set(k, v)
    else n.delete(k)
    if (k === 'sort') n.delete('order')
    setSp(n, { replace: true })
  }

  const genres = useQuery({ queryKey: ['genres', id], queryFn: () => api<string[]>(`/api/libraries/${id}/genres`), staleTime: 300_000 })
  const qs = useMemo(() => new URLSearchParams({ sort, order, genre, played, letter, limit: String(PAGE) }).toString(), [sort, order, genre, played, letter])
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

  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q
  // Re-observing after each page loads fires again while the sentinel is still on screen,
  // so a tall window keeps filling.
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage || isFetchingNextPage) return
    const io = new IntersectionObserver((e) => {
      if (e[0].isIntersecting) fetchNextPage()
    }, { rootMargin: '1200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const shuffle = async () => {
    try {
      const r = await api<{ items: Item[] }>(`/api/libraries/${id}/items?sort=random&limit=1`)
      if (r.items[0]) nav(`/item/${r.items[0].id}`)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t pick something', 'error')
    }
  }

  return (
    <div className="pt-20 md:pt-24 px-4 md:px-10 pb-12">
      <PageTitle
        sub={total ? plural(total, 'title') : undefined}
        right={<button onClick={shuffle} className="btn-ghost !h-10 !px-4" title="Pick something random"><Shuffle className="size-4" /> Surprise me</button>}
      >
        {lib?.name || 'Library'}
      </PageTitle>

      <div className="sticky top-[calc(max(0.625rem,env(safe-area-inset-top))+4rem)] z-30 mb-5 w-fit max-w-full">
        <div className="absolute inset-0 rounded-full glass-bar" aria-hidden />
        <div className="relative flex items-center gap-1.5 p-1.5 overflow-x-auto scrollbar-none rounded-full">
          <Select value={sort} onChange={(v) => set('sort', v)} options={sorts.map((x) => [x.v, x.l])} />
          <button onClick={() => set('order', order === 'asc' ? 'desc' : 'asc')} className="icon-btn-plain !size-9 bg-fg/[.07]" title={order === 'asc' ? 'Ascending' : 'Descending'}>
            {order === 'asc' ? <ArrowUpNarrowWide className="size-4" /> : <ArrowDownWideNarrow className="size-4" />}
          </button>
          <span className="w-px h-5 bg-line shrink-0 mx-1" />
          {(['', 'unplayed', 'played'] as const).map((v) => (
            <button key={v} onClick={() => set('played', v)} className={played === v ? 'pill-on !h-9' : 'pill !h-9'}>
              {v === '' ? 'All' : v === 'unplayed' ? 'Unwatched' : 'Watched'}
            </button>
          ))}
          <Select value={genre} onChange={(v) => set('genre', v)} options={[['', 'All genres'], ...(genres.data || []).map((g) => [g, g] as [string, string])]} active={!!genre} />
        </div>
      </div>

      {sort === 'title' && (
        <div className="flex gap-0.5 overflow-x-auto scrollbar-none mb-5 -mx-1">
          <button onClick={() => set('letter', '')} className={`px-2.5 h-8 rounded-full text-xs font-semibold shrink-0 transition ${!letter ? 'bg-fg/[.12] text-fg' : 'text-fg/45 hover:text-fg'}`}>All</button>
          {letters.map((l) => (
            <button key={l} onClick={() => set('letter', l === letter ? '' : l)} className={`w-8 h-8 rounded-full text-xs font-semibold shrink-0 transition ${letter === l ? 'bg-fg text-bg' : 'text-fg/45 hover:text-fg'}`}>{l}</button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-3 gap-y-6 md:gap-x-5">
        {items.map((it) => <PosterCard key={it.id} item={it} className="cv-auto" />)}
        {(q.isLoading || q.isFetchingNextPage) && Array.from({ length: 12 }).map((_, i) => <CardSkeleton key={'s' + i} />)}
      </div>
      {q.error && !items.length && <EmptyState icon={<Filter className="size-8" />} title="Couldn’t load this library">{(q.error as Error).message}</EmptyState>}
      {!q.isLoading && !q.error && !items.length && <EmptyState icon={<Filter className="size-8" />} title="Nothing matches">Try a different filter.</EmptyState>}
      <div ref={sentinel} className="h-4" />
    </div>
  )
}

/** Native select styled as a pill: the phone's own picker is the best UI here. */
function Select({ value, onChange, options, active }: { value: string; onChange: (v: string) => void; options: [string, string][]; active?: boolean }) {
  return (
    <label className={`relative shrink-0 ${active ? 'pill-on' : 'pill'} !h-9 !pr-8`}>
      {options.find(([v]) => v === value)?.[1] ?? options[0]?.[1]}
      <ChevronDown className="size-4 absolute right-2.5 opacity-60" />
      <select value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}
