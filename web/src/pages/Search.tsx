import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Plus, Search as SearchIcon, X } from 'lucide-react'
import { api } from '../api/client'
import type { Item } from '../api/types'
import { PosterCard, WideCard } from '../components/Cards'
import { useRequestsConfig } from '../components/Layout'
import { EmptyState } from '../components/ui'

export default function SearchPage() {
  const [sp, setSp] = useSearchParams()
  const [text, setText] = useState(sp.get('q') || '')
  const [q, setQ] = useState(text)
  const reqs = useRequestsConfig()
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
  const requestLink = reqs.data?.enabled && q && (
    <Link to={`/requests?q=${encodeURIComponent(q)}`} className="btn-ghost mt-2"><Plus className="size-4" /> Request “{q}”</Link>
  )

  return (
    <div className="pt-20 md:pt-24 px-4 md:px-10 pb-12">
      <div className="relative max-w-2xl mx-auto mb-8">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-muted pointer-events-none" />
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Movies, shows, episodes, people"
          className="input !h-13 !rounded-2xl !pl-12 !pr-12 !text-base"
          enterKeyHint="search"
        />
        {text && (
          <button onClick={() => setText('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 icon-btn !size-8" aria-label="Clear"><X className="size-4" /></button>
        )}
      </div>
      {!q && <EmptyState icon={<SearchIcon className="size-8" />} title="Find something to watch">Search titles, episode names and cast.</EmptyState>}
      {q && res.data && !res.data.length && (
        <EmptyState icon={<SearchIcon className="size-8" />} title={`No results for “${q}”`}>
          {reqs.data?.enabled ? <>It’s not in the library yet.<br />{requestLink}</> : 'Check the spelling or try another title.'}
        </EmptyState>
      )}
      {titles.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-6 md:gap-x-5 mb-12">
          {titles.map((it) => <PosterCard key={it.id} item={it} />)}
        </div>
      )}
      {episodes.length > 0 && (
        <>
          <h2 className="text-[17px] md:text-xl font-semibold tracking-tight mb-4">Episodes</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {episodes.map((it) => <WideCard key={it.id} item={it} />)}
          </div>
        </>
      )}
      {res.data && res.data.length > 0 && requestLink && (
        <div className="text-center mt-12 text-sm text-muted">
          Not what you’re looking for?<br />{requestLink}
        </div>
      )}
    </div>
  )
}
