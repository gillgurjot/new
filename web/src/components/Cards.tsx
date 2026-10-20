import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Play } from 'lucide-react'
import { api, landscapeUrl, posterUrl } from '../api/client'
import type { Item } from '../api/types'
import { episodeLabel, plural, progressPct, remaining } from '../lib/format'
import Img from './Img'

function usePrefetch() {
  const qc = useQueryClient()
  return (id: number) => qc.prefetchQuery({ queryKey: ['item', id], queryFn: () => api(`/api/items/${id}`), staleTime: 30_000 })
}

export function Progress({ pct, className = '' }: { pct: number; className?: string }) {
  if (!pct) return null
  return (
    <div className={`absolute bottom-2 inset-x-2 h-1 rounded-full bg-white/25 overflow-hidden ${className}`}>
      <div className="h-full rounded-full bg-white" style={{ width: `${Math.max(pct, 3)}%` }} />
    </div>
  )
}

function Badge({ item }: { item: Item }) {
  if (item.userData?.played) {
    return (
      <span className="absolute top-2 right-2 size-6 rounded-full bg-black/55 backdrop-blur-md ring-1 ring-white/15 grid place-items-center" title="Watched">
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    )
  }
  if (item.type === 'series' && item.unplayedCount) {
    return (
      <span className="absolute top-2 right-2 min-w-6 h-6 px-1.5 rounded-full bg-accent-strong text-[11px] font-bold grid place-items-center shadow-lg" title={`${item.unplayedCount} unwatched`}>
        {item.unplayedCount > 99 ? '99+' : item.unplayedCount}
      </span>
    )
  }
  return null
}

const frame = 'relative overflow-hidden rounded-xl bg-surface-2 ring-1 ring-inset ring-white/[.06] transition duration-300 group-hover:ring-white/30 group-active:scale-[.98]'

export function PosterCard({ item, className = '' }: { item: Item; className?: string }) {
  const prefetch = usePrefetch()
  const sub = item.type === 'season' ? plural(item.childCount || 0, 'episode') : item.year ? String(item.year) : ''
  return (
    <Link to={`/item/${item.id}`} onMouseEnter={() => prefetch(item.id)} className={`group block ${className}`}>
      <div className={`${frame} aspect-[2/3]`}>
        <Img src={posterUrl(item, 240)} alt={item.title} className="absolute inset-0 size-full group-hover:scale-[1.03] transition-transform duration-500" />
        <Badge item={item} />
        <Progress pct={progressPct(item)} />
      </div>
      <div className="mt-2 px-0.5">
        <div className="text-[13px] md:text-sm font-medium truncate">{item.title}</div>
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
      <div className={`${frame} aspect-video`}>
        <Img src={landscapeUrl(item, 400)} alt={title} className="absolute inset-0 size-full group-hover:scale-[1.03] transition-transform duration-500" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
        <div className="absolute inset-0 hidden md:grid place-items-center bg-black/0 group-hover:bg-black/25 transition">
          <span className="size-12 rounded-full bg-white/95 text-black grid place-items-center shadow-xl opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 transition">
            <Play className="size-5 fill-current ml-0.5" />
          </span>
        </div>
        <Badge item={item} />
        <Progress pct={pct} />
      </div>
      <div className="mt-2 px-0.5">
        <div className="text-[13px] md:text-sm font-medium truncate">{title}</div>
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
