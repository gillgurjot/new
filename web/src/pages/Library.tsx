import { useEffect, useMemo, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Shuffle } from 'lucide-react'
import { api } from '../api/client'
import type { Item } from '../api/types'
import { CardSkeleton, PosterCard } from '../components/Cards'
import { useLibraries } from '../components/Layout'
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
  const letter = sp.get('letter') || ''
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
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((e) => {
      if (e[0].isIntersecting && q.hasNextPage && !q.isFetchingNextPage) q.fetchNextPage()
    }, { rootMargin: '1200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [q])

  const shuffle = async () => {
    const r = await api<{ items: Item[] }>(`/api/libraries/${id}/items?sort=random&limit=1`)
    if (r.items[0]) nav(`/item/${r.items[0].id}`)
  }

  return (
    <div className="pt-20 md:pt-24 px-4 md:px-10 pb-12">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-2xl md:text-3xl font-black tracking-tight mr-auto">
          {lib?.name || 'Library'} <span className="text-muted text-base font-medium ml-1">{total ? total.toLocaleString() : ''}</span>
        </h1>
        <button onClick={shuffle} className="icon-btn" title="Pick something random"><Shuffle className="size-4" /></button>
        <select value={sort} onChange={(e) => set('sort', e.target.value)} className="input !w-auto !h-10 !rounded-full pr-8">
          {sorts.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
        </select>
        <button onClick={() => set('order', order === 'asc' ? 'desc' : 'asc')} className="icon-btn !size-10" title="Reverse order">
          {order === 'asc' ? <ArrowUpNarrowWide className="size-4" /> : <ArrowDownWideNarrow className="size-4" />}
        </button>
        <select value={genre} onChange={(e) => set('genre', e.target.value)} className="input !w-auto !h-10 !rounded-full pr-8">
          <option value="">All genres</option>
          {genres.data?.map((g) => <option key={g}>{g}</option>)}
        </select>
        <select value={played} onChange={(e) => set('played', e.target.value)} className="input !w-auto !h-10 !rounded-full pr-8">
          <option value="">All</option>
          <option value="unplayed">Unwatched</option>
          <option value="played">Watched</option>
        </select>
      </div>

      {sort === 'title' && (
        <div className="flex gap-0.5 overflow-x-auto scrollbar-none mb-5 -mx-1">
          <button onClick={() => set('letter', '')} className={`px-2 h-8 rounded-md text-xs font-semibold shrink-0 ${!letter ? 'bg-white/15' : 'text-white/50 hover:text-white'}`}>All</button>
          {letters.map((l) => (
            <button key={l} onClick={() => set('letter', l === letter ? '' : l)} className={`w-7 h-8 rounded-md text-xs font-semibold shrink-0 ${letter === l ? 'bg-violet-500 text-white' : 'text-white/50 hover:text-white'}`}>{l}</button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-3 gap-y-6 md:gap-x-5">
        {items.map((it) => <PosterCard key={it.id} item={it} className="cv-auto" />)}
        {(q.isLoading || q.isFetchingNextPage) && Array.from({ length: 12 }).map((_, i) => <CardSkeleton key={'s' + i} />)}
      </div>
      {!q.isLoading && !items.length && <p className="text-center text-muted py-20">Nothing matches these filters.</p>}
      <div ref={sentinel} className="h-4" />
    </div>
  )
}
