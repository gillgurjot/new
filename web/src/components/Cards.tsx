import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Play } from 'lucide-react'
import { api, landscapeUrl, posterUrl } from '../api/client'
import type { Item } from '../api/types'
import { episodeLabel, progressPct, remaining } from '../lib/format'
import Img from './Img'

function usePrefetch() {
  const qc = useQueryClient()
  return (id: number) => qc.prefetchQuery({ queryKey: ['item', id], queryFn: () => api(`/api/items/${id}`), staleTime: 30_000 })
}

function Progress({ pct }: { pct: number }) {
  if (!pct) return null
  return (
    <div className="absolute bottom-0 inset-x-0 h-1 bg-black/50">
      <div className="h-full bg-gradient-to-r from-violet-400 to-pink-400" style={{ width: `${pct}%` }} />
    </div>
  )
}

function Badge({ item }: { item: Item }) {
  if (item.userData?.played) {
    return (
      <span className="absolute top-2 right-2 size-6 rounded-full bg-violet-500 grid place-items-center shadow-lg">
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    )
  }
  if (item.type === 'series' && item.unplayedCount) {
    return <span className="absolute top-2 right-2 min-w-6 h-6 px-1.5 rounded-full bg-violet-500 text-xs font-bold grid place-items-center shadow-lg">{item.unplayedCount}</span>
  }
  return null
}

export function PosterCard({ item, className = '' }: { item: Item; className?: string }) {
  const prefetch = usePrefetch()
  const sub = item.type === 'season' ? `${item.childCount} episodes` : item.year ? String(item.year) : ''
  return (
    <Link to={`/item/${item.id}`} onMouseEnter={() => prefetch(item.id)} className={`group block ${className}`}>
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden ring-1 ring-white/5 group-hover:ring-2 group-hover:ring-violet-400/80 transition shadow-lg shadow-black/30">
        <Img src={posterUrl(item, 240)} alt={item.title} className="absolute inset-0 size-full group-hover:scale-[1.04] transition-transform duration-500" />
        <Badge item={item} />
        <Progress pct={progressPct(item)} />
      </div>
      <div className="mt-2 px-0.5">
        <div className="text-sm font-medium truncate">{item.title}</div>
        {sub && <div className="text-xs text-muted">{sub}</div>}
      </div>
    </Link>
  )
}

/** Landscape card used for continue watching, next up and episodes. */
export function WideCard({ item, className = '', play = false }: { item: Item; className?: string; play?: boolean }) {
  const prefetch = usePrefetch()
  const pct = progressPct(item)
  const title = item.type === 'episode' ? item.seriesTitle || item.title : item.title
  const sub = item.type === 'episode' ? `${episodeLabel(item)} · ${item.title}` : pct ? remaining(item) : item.year ? String(item.year) : ''
  return (
    <Link to={play ? `/play/${item.id}` : `/item/${item.id}`} onMouseEnter={() => prefetch(item.id)} className={`group block ${className}`}>
      <div className="relative aspect-video rounded-xl overflow-hidden ring-1 ring-white/5 group-hover:ring-2 group-hover:ring-violet-400/80 transition shadow-lg shadow-black/30">
        <Img src={landscapeUrl(item, 400)} alt={title} className="absolute inset-0 size-full group-hover:scale-[1.04] transition-transform duration-500" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition grid place-items-center">
          <span className="size-12 rounded-full bg-white/90 text-black grid place-items-center opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100 transition">
            <Play className="size-5 fill-current ml-0.5" />
          </span>
        </div>
        <Badge item={item} />
        <Progress pct={pct} />
      </div>
      <div className="mt-2 px-0.5">
        <div className="text-sm font-medium truncate">{title}</div>
        {sub && <div className="text-xs text-muted truncate">{sub}</div>}
      </div>
    </Link>
  )
}

export function CardSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div>
      <div className={`skeleton rounded-xl ${wide ? 'aspect-video' : 'aspect-[2/3]'}`} />
      <div className="skeleton h-3 rounded mt-2 w-3/4" />
    </div>
  )
}
