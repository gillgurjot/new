import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CheckCircle2, Clock, Download, ExternalLink, Play, Plus, Search, Star, X } from 'lucide-react'
import { ApiError, api, post, tmdbImage } from '../api/client'
import type { RecentRequest, RequestDetails, RequestSeason, RequestStatus, RequestTitle } from '../api/types'
import Img from '../components/Img'
import Row from '../components/Row'
import Spinner from '../components/Spinner'
import { useRequestsConfig } from '../components/Layout'
import { EmptyState, Meta, PageTitle, Sheet, toast } from '../components/ui'
import { formatRuntime, timeAgo } from '../lib/format'

type Page = { results: RequestTitle[]; page: number; totalPages: number }

const lists = [
  { v: 'trending', l: 'Trending' },
  { v: 'movies', l: 'Popular movies' },
  { v: 'tv', l: 'Popular shows' },
  { v: 'upcoming', l: 'Coming soon' },
]

export const statusInfo: Record<RequestStatus, { label: string; cls: string; icon?: React.ReactNode }> = {
  none: { label: '', cls: '' },
  pending: { label: 'Requested', cls: 'bg-amber-400 text-black', icon: <Clock className="size-3" /> },
  processing: { label: 'Downloading', cls: 'bg-sky-400 text-black', icon: <Download className="size-3" /> },
  partial: { label: 'Partly here', cls: 'bg-white text-black', icon: <Check className="size-3" strokeWidth={3} /> },
  available: { label: 'In library', cls: 'bg-emerald-400 text-black', icon: <Check className="size-3" strokeWidth={3} /> },
}

export default function RequestsPage() {
  const cfg = useRequestsConfig()
  const [sp, setSp] = useSearchParams()
  const [text, setText] = useState(sp.get('q') || '')
  const [q, setQ] = useState(text.trim())
  const [list, setList] = useState('trending')
  const [open, setOpen] = useState<RequestTitle | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(text.trim())
      setSp(text.trim() ? { q: text.trim() } : {}, { replace: true })
    }, 300)
    return () => clearTimeout(t)
  }, [text, setSp])

  const enabled = !!cfg.data?.enabled
  const browse = useInfiniteQuery({
    queryKey: ['requests', q ? 'search' : list, q],
    queryFn: ({ pageParam }) =>
      api<Page>(q ? `/api/requests/search?q=${encodeURIComponent(q)}&page=${pageParam}` : `/api/requests/discover/${list}?page=${pageParam}`),
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

  if (cfg.isLoading) return <div className="pt-32 grid place-items-center"><Spinner /></div>
  if (!enabled) {
    return (
      <div className="pt-24 px-4">
        <EmptyState icon={<Plus className="size-8" />} title="Requests aren’t set up">
          An admin can connect Seerr by setting <code className="text-white/80">SEERR_URL</code> and <code className="text-white/80">SEERR_API_KEY</code>.
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="pt-20 md:pt-24 pb-12">
      <div className="px-4 md:px-10">
        <PageTitle sub="Find a movie or show and request it. It’s downloaded and added to the library automatically.">Request</PageTitle>
        {!cfg.data?.canRequest && (
          <div className="mb-5 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">Requests are turned off for your account. You can still browse.</div>
        )}
        <div className="relative max-w-2xl mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-muted pointer-events-none" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search every movie and show" className="input !h-13 !rounded-2xl !pl-12 !pr-12 !text-base" enterKeyHint="search" />
          {text && <button onClick={() => setText('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 icon-btn !size-8" aria-label="Clear"><X className="size-4" /></button>}
        </div>
      </div>

      {!q && (recent.data?.length || 0) > 0 && (
        <div className="mb-9">
          <Row title="Recent requests">
            {recent.data!.map((r) => (
              <button key={r.id} onClick={() => setOpen(r.title)} className="text-left group">
                <TitlePoster t={{ ...r.title, status: r.status === 'available' ? 'available' : r.status === 'approved' ? 'processing' : r.status === 'pending' ? 'pending' : r.title.status }} />
                <div className="mt-2 px-0.5">
                  <div className="text-[13px] font-medium truncate">{r.title.title}</div>
                  <div className="text-xs text-muted truncate">{r.status === 'declined' ? 'Declined' : r.status === 'failed' ? 'Failed' : r.requestedBy} · {timeAgo(Date.parse(r.createdAt) / 1000)}</div>
                </div>
              </button>
            ))}
          </Row>
        </div>
      )}

      <div className="px-4 md:px-10">
        {!q && (
          <div className="flex gap-2 overflow-x-auto scrollbar-none -mx-4 px-4 md:mx-0 md:px-0 mb-5">
            {lists.map((x) => <button key={x.v} onClick={() => setList(x.v)} className={list === x.v ? 'pill-on' : 'pill'}>{x.l}</button>)}
          </div>
        )}
        {browse.error && <p className="text-sm text-red-300 mb-4">{(browse.error as Error).message}</p>}
        {q && browse.data && !results.length && <EmptyState icon={<Search className="size-8" />} title={`Nothing found for “${q}”`}>Try the original title or fewer words.</EmptyState>}
        <div className="grid grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-x-3 gap-y-6 md:gap-x-5">
          {results.map((t) => (
            <button key={t.mediaType + t.tmdbId} onClick={() => setOpen(t)} className="text-left group">
              <TitlePoster t={t} />
              <div className="mt-2 px-0.5">
                <div className="text-[13px] md:text-sm font-medium truncate">{t.title}</div>
                <div className="text-xs text-muted">{[t.year, t.mediaType === 'tv' ? 'Show' : 'Movie'].filter(Boolean).join(' · ')}</div>
              </div>
            </button>
          ))}
          {browse.isLoading && Array.from({ length: 12 }).map((_, i) => <div key={i}><div className="skeleton aspect-[2/3] rounded-xl" /><div className="skeleton h-3 mt-2 w-2/3 rounded" /></div>)}
        </div>
        {browse.hasNextPage && (
          <div className="flex justify-center mt-8">
            <button onClick={() => browse.fetchNextPage()} disabled={browse.isFetchingNextPage} className="btn-ghost">{browse.isFetchingNextPage ? <Spinner className="size-4" /> : 'Load more'}</button>
          </div>
        )}
      </div>
      <RequestSheet title={open} onClose={() => setOpen(null)} canRequest={!!cfg.data?.canRequest} seerrUrl={cfg.data?.seerrUrl} />
    </div>
  )
}

function TitlePoster({ t }: { t: RequestTitle }) {
  const st = statusInfo[t.status]
  return (
    <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-surface-2 ring-1 ring-inset ring-white/[.06] transition group-hover:ring-white/30 group-active:scale-[.98]">
      <Img src={tmdbImage(t.poster, 'w342')} alt={t.title} className="absolute inset-0 size-full group-hover:scale-[1.03] transition-transform duration-500" />
      {st.label && (
        <span className={`absolute top-2 left-2 inline-flex items-center gap-1 h-5 px-1.5 rounded-md text-[10px] font-bold uppercase tracking-wide shadow ${st.cls}`}>
          {st.icon}{st.label}
        </span>
      )}
    </div>
  )
}

function RequestSheet({ title, onClose, canRequest, seerrUrl }: { title: RequestTitle | null; onClose: () => void; canRequest: boolean; seerrUrl?: string }) {
  const qc = useQueryClient()
  const d = useQuery({
    queryKey: ['request-title', title?.mediaType, title?.tmdbId],
    queryFn: () => api<RequestDetails>(`/api/requests/title/${title!.mediaType}/${title!.tmdbId}`),
    enabled: !!title,
    retry: false,
  })
  const [picked, setPicked] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => setPicked([]), [title?.tmdbId])
  const t = d.data?.title || title
  if (!t) return <Sheet open={false} onClose={onClose}>{null}</Sheet>
  const seasons = d.data?.seasons || []
  const open = seasons.filter((s) => s.status === 'none')
  const isTV = t.mediaType === 'tv'
  const canAsk = canRequest && (isTV ? open.length > 0 : t.status === 'none')

  const send = async () => {
    setBusy(true)
    try {
      const all = isTV && (picked.length === 0 || picked.length === open.length) && open.length === seasons.length
      await post('/api/requests', { mediaType: t.mediaType, tmdbId: t.tmdbId, seasons: isTV ? (all ? [] : picked.length ? picked : open.map((s) => s.seasonNumber)) : undefined })
      toast(`Requested ${t.title}`)
      qc.invalidateQueries({ queryKey: ['requests'] })
      qc.invalidateQueries({ queryKey: ['request-title', t.mediaType, t.tmdbId] })
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Request failed', 'error')
    } finally {
      setBusy(false)
    }
  }
  const togglePick = (s: RequestSeason) => setPicked((p) => (p.includes(s.seasonNumber) ? p.filter((x) => x !== s.seasonNumber) : [...p, s.seasonNumber]))
  const requestLabel = isTV ? (picked.length && picked.length < open.length ? `Request ${picked.length} season${picked.length > 1 ? 's' : ''}` : open.length === seasons.length ? 'Request all seasons' : 'Request missing seasons') : 'Request'

  return (
    <Sheet open={!!title} onClose={onClose} wide>
      <div className="-mx-5 -mt-2 sm:mt-0 relative aspect-[16/8] sm:rounded-t-3xl overflow-hidden bg-surface-2">
        <Img src={tmdbImage(t.backdrop, 'w1280')} alt="" className="absolute inset-0 size-full" fallback={<span />} />
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/30 to-transparent" />
        <button onClick={onClose} className="absolute top-3 right-3 icon-btn !size-9 !bg-black/50" aria-label="Close"><X className="size-4" /></button>
      </div>
      <div className="flex gap-4 -mt-16 relative">
        <div className="w-24 shrink-0 aspect-[2/3] rounded-xl overflow-hidden ring-1 ring-white/10 shadow-2xl bg-surface-2">
          <Img src={tmdbImage(t.poster, 'w342')} alt={t.title} className="size-full" />
        </div>
        <div className="min-w-0 pt-10">
          <h3 className="text-xl font-bold tracking-tight leading-tight">{t.title}</h3>
          <Meta
            className="text-[13px] text-muted mt-1"
            parts={[
              t.year || null,
              isTV ? 'Show' : 'Movie',
              d.data?.runtime ? formatRuntime(d.data.runtime) : null,
              t.rating ? <span className="inline-flex items-center gap-1"><Star className="size-3 fill-amber-400 text-amber-400" />{t.rating.toFixed(1)}</span> : null,
            ]}
          />
        </div>
      </div>
      {d.data?.genres?.length ? <div className="text-xs text-muted mt-3">{d.data.genres.join(' · ')}</div> : null}
      {t.overview && <p className="text-sm text-white/80 leading-relaxed mt-3">{t.overview}</p>}

      {d.isLoading && <div className="py-6 grid place-items-center"><Spinner className="size-6" /></div>}
      {d.error && <p className="text-sm text-red-300 mt-4">{(d.error as Error).message}</p>}

      {isTV && seasons.length > 0 && (
        <div className="mt-5">
          <div className="eyebrow mb-2">Seasons</div>
          <div className="space-y-1">
            {seasons.map((s) => {
              const st = statusInfo[s.status]
              const selectable = s.status === 'none' && canRequest
              const on = picked.includes(s.seasonNumber)
              return (
                <button key={s.seasonNumber} disabled={!selectable} onClick={() => togglePick(s)} className={`w-full flex items-center gap-3 px-3 h-12 rounded-xl text-left transition ${selectable ? 'hover:bg-white/[.06]' : ''} ${on ? 'bg-white/[.08]' : ''}`}>
                  <span className={`size-5 rounded-md border grid place-items-center shrink-0 ${on ? 'bg-white border-white text-black' : selectable ? 'border-white/30' : 'border-transparent'}`}>
                    {on && <Check className="size-3.5" strokeWidth={3} />}
                    {!selectable && s.status !== 'none' && <CheckCircle2 className="size-4 text-white/40" />}
                  </span>
                  <span className="text-sm font-medium flex-1 min-w-0 truncate">{s.name || `Season ${s.seasonNumber}`}</span>
                  <span className="text-xs text-muted">{s.episodeCount} ep</span>
                  {st.label && <span className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-md text-[10px] font-bold uppercase tracking-wide ${st.cls}`}>{st.label}</span>}
                </button>
              )
            })}
          </div>
          {open.length > 0 && canRequest && <p className="text-xs text-muted mt-2">Pick seasons, or leave them all unticked to request everything that’s missing.</p>}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2.5 mt-6">
        {t.itemId ? (
          <Link to={`/item/${t.itemId}`} onClick={onClose} className="btn-primary !h-12 w-full sm:w-auto sm:flex-1"><Play className="size-5 fill-current" /> Watch now</Link>
        ) : null}
        {canAsk ? (
          <button onClick={send} disabled={busy || d.isLoading} className={`${t.itemId ? 'btn-ghost' : 'btn-accent'} !h-12 w-full sm:w-auto sm:flex-1`}>
            {busy ? <Spinner className="size-5" /> : <><Plus className="size-5" /> {requestLabel}</>}
          </button>
        ) : !t.itemId && t.status !== 'none' ? (
          <div className="w-full sm:flex-1 min-h-12 px-4 py-2 rounded-full bg-white/[.06] grid place-items-center text-center text-sm text-white/70">
            {t.status === 'pending' ? 'Requested — waiting for approval' : t.status === 'processing' ? 'Requested — downloading' : t.status === 'available' ? 'Available — the library will update shortly' : 'Partly available'}
          </div>
        ) : null}
        {seerrUrl && (
          <a href={`${seerrUrl}/${t.mediaType}/${t.tmdbId}`} target="_blank" rel="noreferrer" className="btn-ghost !h-12 w-full sm:w-auto sm:!px-5" title="Open in Seerr"><ExternalLink className="size-4" /><span className="sm:hidden">Open in Seerr</span></a>
        )}
      </div>
    </Sheet>
  )
}
