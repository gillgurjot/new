import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Search as SearchIcon, X } from 'lucide-react'
import { api } from '../api/client'
import type { Item } from '../api/types'
import { PosterCard, WideCard } from '../components/Cards'

export default function SearchPage() {
  const [sp, setSp] = useSearchParams()
  const [text, setText] = useState(sp.get('q') || '')
  const [q, setQ] = useState(text)
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(text.trim())
      setSp(text.trim() ? { q: text.trim() } : {}, { replace: true })
    }, 200)
    return () => clearTimeout(t)
  }, [text, setSp])
  const res = useQuery({ queryKey: ['search', q], queryFn: () => api<Item[]>(`/api/search?q=${encodeURIComponent(q)}`), enabled: q.length > 0, placeholderData: keepPreviousData })
  const titles = res.data?.filter((i) => i.type !== 'episode') || []
  const episodes = res.data?.filter((i) => i.type === 'episode') || []

  return (
    <div className="pt-20 md:pt-24 px-4 md:px-10 pb-12">
      <div className="relative max-w-2xl mx-auto mb-10">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-muted" />
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Search movies, shows, episodes, people…" className="input !h-14 !rounded-2xl !pl-12 !text-base" />
        {text && (
          <button onClick={() => setText('')} className="absolute right-3 top-1/2 -translate-y-1/2 icon-btn !size-8" aria-label="Clear"><X className="size-4" /></button>
        )}
      </div>
      {q && res.data && !res.data.length && <p className="text-center text-muted">No results for “{q}”.</p>}
      {titles.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6 mb-12">
          {titles.map((it) => <PosterCard key={it.id} item={it} />)}
        </div>
      )}
      {episodes.length > 0 && (
        <>
          <h2 className="text-lg font-bold mb-4">Episodes</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {episodes.map((it) => <WideCard key={it.id} item={it} />)}
          </div>
        </>
      )}
    </div>
  )
}
