import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Heart, MoreHorizontal, Play, RefreshCw, RotateCcw, Search, Star, X } from 'lucide-react'
import { api, del, imageUrl, landscapeUrl, personImage, post, posterUrl } from '../api/client'
import type { Item, ItemDetail, UserData } from '../api/types'
import Img from '../components/Img'
import Row from '../components/Row'
import Spinner from '../components/Spinner'
import { bytes, episodeLabel, formatRuntime, formatTime, progressPct, resolutionLabel } from '../lib/format'
import { useUser } from '../lib/user'

export default function ItemPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { data: item, isLoading } = useQuery({ queryKey: ['item', Number(id)], queryFn: () => api<ItemDetail>(`/api/items/${id}`), refetchOnMount: 'always' })
  if (isLoading || !item) {
    return (
      <div className="pt-24 px-4 md:px-10">
        <div className="skeleton h-[45vh] rounded-3xl" />
      </div>
    )
  }
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['item'] })
    qc.invalidateQueries({ queryKey: ['children'] })
    qc.invalidateQueries({ queryKey: ['home'] })
  }
  return <Detail item={item} onChange={refresh} />
}

function Detail({ item, onChange }: { item: ItemDetail; onChange: () => void }) {
  const user = useUser()
  const nav = useNavigate()
  const isPlayable = item.type === 'movie' || item.type === 'episode'
  const backdropId = item.type === 'movie' || item.type === 'series' ? item.id : item.seriesId
  const backdrop = item.images.backdrop ? imageUrl(item, 'backdrop', 1920) : backdropId ? `/api/images/${backdropId}/backdrop?w=1920` : landscapeUrl(item, 1920)
  const logo = item.type === 'movie' || item.type === 'series' ? imageUrl(item, 'logo', 500) : undefined

  // For series/seasons the play button targets the next unwatched episode.
  const episodes = useQuery({
    queryKey: ['children', 'episodes', item.type === 'series' ? item.id : item.seriesId],
    queryFn: () => api<Item[]>(`/api/items/${item.type === 'series' ? item.id : item.seriesId}/episodes`),
    enabled: item.type === 'series' || item.type === 'season',
  })
  const nextEp = useMemo(() => {
    const eps = (episodes.data || []).filter((e) => item.type !== 'season' || e.parentId === item.id)
    const regular = eps.filter((e) => e.seasonNumber !== 0)
    const inProgress = regular.find((e) => !e.userData?.played && (e.userData?.position || 0) > 30)
    if (inProgress) return inProgress
    // Next after the last watched one, else the first.
    let lastIdx = -1
    regular.forEach((e, i) => e.userData?.played && (lastIdx = i))
    return regular.slice(lastIdx + 1).find((e) => !e.userData?.played) || regular[0] || eps[0]
  }, [episodes.data, item])

  const playTarget = isPlayable ? item : nextEp
  const resumePos = playTarget?.userData?.played ? 0 : playTarget?.userData?.position || 0

  const ud = item.userData
  const toggle = async (kind: 'played' | 'favorite', on: boolean) => {
    await (on ? post<UserData>(`/api/items/${item.id}/${kind}`) : del<UserData>(`/api/items/${item.id}/${kind}`))
    onChange()
  }

  const directors = item.people?.filter((p) => p.role === 'director' || p.role === 'creator') || []
  const cast = item.people?.filter((p) => p.role === 'actor' || p.role === 'guest') || []

  return (
    <div className="pb-16">
      <div className="relative">
        <div className="absolute inset-0 h-[75vh] overflow-hidden">
          {backdrop && <img src={backdrop} alt="" className="size-full object-cover opacity-60" />}
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/10" />
          <div className="absolute inset-0 bg-gradient-to-r from-bg/90 via-bg/40 to-transparent" />
        </div>

        <div className="relative pt-24 md:pt-36 px-4 md:px-10 flex flex-col md:flex-row gap-8 items-start">
          {item.type !== 'episode' && (
            <div className="hidden md:block w-64 shrink-0 aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10">
              <Img src={posterUrl(item, 300)} alt={item.title} className="size-full" />
            </div>
          )}
          {item.type === 'episode' && (
            <div className="w-full md:w-[420px] shrink-0 aspect-video rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10">
              <Img src={landscapeUrl(item, 640)} alt={item.title} className="size-full" />
            </div>
          )}
          <div className="flex-1 min-w-0 fade-in">
            {item.seriesTitle && (
              <Link to={`/item/${item.seriesId}`} className="text-violet-300 hover:text-violet-200 font-semibold text-sm">{item.seriesTitle}</Link>
            )}
            {logo ? (
              <img src={logo} alt={item.title} className="max-h-32 max-w-[80%] object-contain object-left my-3 drop-shadow-2xl" />
            ) : (
              <h1 className="text-3xl md:text-5xl font-black tracking-tight my-2">{item.title}</h1>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-white/80 mb-4">
              {item.type === 'episode' && <span className="font-semibold">{episodeLabel(item)}</span>}
              {item.year ? <span>{item.year}</span> : null}
              {item.rating ? <span className="inline-flex items-center gap-1"><Star className="size-4 fill-yellow-400 text-yellow-400" />{item.rating.toFixed(1)}</span> : null}
              {item.contentRating && <span className="chip">{item.contentRating}</span>}
              {isPlayable && <span>{formatRuntime(item.runtime, item.duration)}</span>}
              {item.type === 'series' && item.childCount ? <span>{item.childCount} {item.childCount === 1 ? 'season' : 'seasons'}</span> : null}
              {item.media && <span className="chip">{resolutionLabel(item.media.width, item.media.height)}</span>}
              {item.media?.hdr && <span className="chip !border-yellow-400/40 text-yellow-200">{item.media.hdr === 'dovi' ? 'Dolby Vision' : item.media.hdr.toUpperCase()}</span>}
            </div>
            {item.genres.length > 0 && <div className="text-sm text-muted mb-4">{item.genres.join(' · ')}</div>}
            {item.tagline && <p className="italic text-white/70 mb-2">{item.tagline}</p>}
            <Overview text={item.overview} />

            <div className="flex flex-wrap items-center gap-3 mt-6">
              {playTarget && (
                <button onClick={() => nav(`/play/${playTarget.id}`)} className="btn-primary !h-12 !px-7 !text-base">
                  <Play className="size-5 fill-current" />
                  {resumePos > 30 ? `Resume ${formatTime(resumePos)}` : item.type === 'series' || item.type === 'season' ? `Play ${episodeLabel(playTarget)}` : 'Play'}
                </button>
              )}
              {playTarget && resumePos > 30 && (
                <button onClick={() => nav(`/play/${playTarget.id}?t=0`)} className="btn-ghost !h-12" title="Start from the beginning">
                  <RotateCcw className="size-5" /> Start over
                </button>
              )}
              <button onClick={() => toggle('played', !ud?.played)} className={`icon-btn !size-12 ${ud?.played ? '!bg-violet-500' : ''}`} title={ud?.played ? 'Mark unwatched' : 'Mark watched'}>
                <Check className="size-5" />
              </button>
              <button onClick={() => toggle('favorite', !ud?.favorite)} className="icon-btn !size-12" title={ud?.favorite ? 'Remove from favorites' : 'Add to favorites'}>
                <Heart className={`size-5 ${ud?.favorite ? 'fill-pink-500 text-pink-500' : ''}`} />
              </button>
              {user.isAdmin && (item.type === 'movie' || item.type === 'series') && <AdminMenu item={item} onChange={onChange} />}
            </div>
            {playTarget && progressPct(playTarget) > 0 && !playTarget.userData?.played && (
              <div className="mt-4 max-w-sm h-1 rounded bg-white/15 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-violet-400 to-pink-400" style={{ width: `${progressPct(playTarget)}%` }} />
              </div>
            )}
            {directors.length > 0 && (
              <div className="text-sm text-muted mt-6">
                {directors[0].role === 'creator' ? 'Created by ' : 'Directed by '}
                <span className="text-white/90">{directors.map((d) => d.name).join(', ')}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="relative mt-12 space-y-12">
        {(item.type === 'series' || item.type === 'season') && <Seasons item={item} episodes={episodes.data} />}
        {cast.length > 0 && (
          <Row title={item.type === 'episode' ? 'Guest stars' : 'Cast'}>
            {cast.map((p, i) => (
              <div key={p.name + i} className="!w-[110px] md:!w-[130px]">
                <div className="aspect-square rounded-full overflow-hidden ring-1 ring-white/10">
                  <Img src={personImage(p.profile)} alt={p.name} className="size-full" fallback={<span className="text-2xl font-bold text-white/40">{p.name.slice(0, 1)}</span>} />
                </div>
                <div className="text-center mt-2">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-xs text-muted truncate">{p.character}</div>
                </div>
              </div>
            ))}
          </Row>
        )}
        {item.media && <MediaInfo item={item} />}
      </div>
    </div>
  )
}

function Overview({ text }: { text?: string }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  return (
    <p onClick={() => setOpen((o) => !o)} className={`text-white/85 max-w-3xl leading-relaxed cursor-pointer ${open ? '' : 'line-clamp-4'}`}>
      {text}
    </p>
  )
}

function Seasons({ item, episodes }: { item: ItemDetail; episodes?: Item[] }) {
  const [sp, setSp] = useSearchParams()
  const seriesId = item.type === 'series' ? item.id : item.seriesId!
  const seasons = useQuery({ queryKey: ['children', seriesId], queryFn: () => api<Item[]>(`/api/items/${seriesId}/children`) })
  const list = seasons.data || []
  const initial = item.type === 'season' ? item.id : Number(sp.get('season')) || list.find((s) => s.unplayedCount && s.seasonNumber !== 0)?.id || list[0]?.id
  const [sel, setSel] = useState<number | undefined>(initial)
  useEffect(() => setSel(initial), [initial])
  const eps = (episodes || []).filter((e) => e.parentId === sel)
  if (!list.length) return null
  return (
    <section className="px-4 md:px-10">
      <div className="flex gap-2 overflow-x-auto scrollbar-none mb-5">
        {list.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              setSel(s.id)
              if (item.type === 'series') setSp({ season: String(s.id) }, { replace: true })
            }}
            className={`shrink-0 px-4 h-10 rounded-full text-sm font-semibold transition ${sel === s.id ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/20'}`}
          >
            {s.title}
            {s.unplayedCount ? <span className={`ml-2 text-xs ${sel === s.id ? 'text-black/60' : 'text-white/50'}`}>{s.unplayedCount}</span> : null}
          </button>
        ))}
      </div>
      {!episodes && <Spinner />}
      <div className="grid gap-3">
        {eps.map((e) => <EpisodeRow key={e.id} ep={e} />)}
      </div>
    </section>
  )
}

function EpisodeRow({ ep }: { ep: Item }) {
  const pct = progressPct(ep)
  return (
    <div className="group flex gap-4 p-2 -mx-2 rounded-2xl hover:bg-white/5 transition">
      <Link to={`/play/${ep.id}`} className="relative w-40 sm:w-56 shrink-0 aspect-video rounded-xl overflow-hidden ring-1 ring-white/5">
        <Img src={landscapeUrl(ep, 320)} alt={ep.title} className="size-full" />
        <div className="absolute inset-0 grid place-items-center bg-black/0 group-hover:bg-black/40 transition">
          <Play className="size-8 fill-white opacity-0 group-hover:opacity-100 transition" />
        </div>
        {ep.userData?.played && <span className="absolute top-1.5 right-1.5 size-5 rounded-full bg-violet-500 grid place-items-center"><Check className="size-3" strokeWidth={3} /></span>}
        {pct > 0 && <div className="absolute bottom-0 inset-x-0 h-1 bg-black/50"><div className="h-full bg-violet-400" style={{ width: `${pct}%` }} /></div>}
      </Link>
      <Link to={`/item/${ep.id}`} className="min-w-0 flex-1 py-1">
        <div className="flex items-baseline gap-2">
          <span className="text-muted text-sm font-semibold shrink-0">{ep.episodeNumber}{ep.episodeEnd ? `–${ep.episodeEnd}` : ''}</span>
          <span className="font-semibold truncate">{ep.title}</span>
          <span className="ml-auto text-xs text-muted shrink-0">{formatRuntime(ep.runtime, ep.duration)}</span>
        </div>
        {ep.premiereDate && <div className="text-xs text-muted mt-0.5">{new Date(ep.premiereDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</div>}
        <p className="text-sm text-white/70 mt-1.5 line-clamp-2 hidden sm:block">{ep.overview}</p>
      </Link>
    </div>
  )
}

function MediaInfo({ item }: { item: ItemDetail }) {
  const m = item.media!
  const audio = m.streams.filter((s) => s.type === 'audio')
  const subs = [...m.streams.filter((s) => s.type === 'subtitle'), ...m.sidecars]
  return (
    <section className="px-4 md:px-10">
      <h2 className="text-lg md:text-xl font-bold mb-3">Media info</h2>
      <div className="grid sm:grid-cols-3 gap-3 text-sm">
        <div className="card p-4">
          <div className="text-muted text-xs uppercase tracking-wide mb-2">Video</div>
          <div>{m.videoCodec.toUpperCase()} {m.videoProfile && <span className="text-muted">({m.videoProfile})</span>}</div>
          <div>{m.width}×{m.height} {m.hdr && `· ${m.hdr.toUpperCase()}`}</div>
          <div className="text-muted">{m.container.toUpperCase()} · {(m.bitrate / 1e6).toFixed(1)} Mbps · {bytes(m.size)}</div>
        </div>
        <div className="card p-4">
          <div className="text-muted text-xs uppercase tracking-wide mb-2">Audio</div>
          {audio.map((a) => <div key={a.index} className="truncate">{(a.language || 'und').toUpperCase()} · {a.codec.toUpperCase()} {a.channels}ch {a.title && <span className="text-muted">· {a.title}</span>}</div>)}
          {!audio.length && <div className="text-muted">None</div>}
        </div>
        <div className="card p-4">
          <div className="text-muted text-xs uppercase tracking-wide mb-2">Subtitles</div>
          {subs.map((s) => <div key={s.index} className="truncate">{(s.language || 'und').toUpperCase()} · {s.codec.toUpperCase()}{s.forced ? ' · Forced' : ''}{s.external ? ' · External' : ''}</div>)}
          {!subs.length && <div className="text-muted">None</div>}
        </div>
      </div>
    </section>
  )
}

function AdminMenu({ item, onChange }: { item: Item; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const [identify, setIdentify] = useState(false)
  const [busy, setBusy] = useState(false)
  const refresh = async () => {
    setBusy(true)
    setOpen(false)
    await post(`/api/admin/items/${item.id}/refresh`)
    setTimeout(() => {
      setBusy(false)
      onChange()
    }, 4000)
  }
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="icon-btn !size-12" title="More">{busy ? <Spinner className="size-5" /> : <MoreHorizontal className="size-5" />}</button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 left-0 mt-2 w-56 card p-1.5 shadow-2xl fade-in">
            <button onClick={refresh} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/10 text-sm"><RefreshCw className="size-4" /> Refresh metadata</button>
            <button onClick={() => { setIdentify(true); setOpen(false) }} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/10 text-sm"><Search className="size-4" /> Fix match…</button>
          </div>
        </>
      )}
      {identify && <IdentifyDialog item={item} onClose={() => setIdentify(false)} onDone={() => { setIdentify(false); setTimeout(onChange, 4000) }} />}
    </div>
  )
}

interface Match { id: number; title: string; year: number; overview: string; poster?: string }

function IdentifyDialog({ item, onClose, onDone }: { item: Item; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState(item.title)
  const [year, setYear] = useState(item.year ? String(item.year) : '')
  const [query, setQuery] = useState({ q: item.title, year })
  const res = useQuery({
    queryKey: ['identify', item.id, query],
    queryFn: () => api<Match[]>(`/api/admin/identify?itemId=${item.id}&q=${encodeURIComponent(query.q)}&year=${query.year}`),
    retry: false,
  })
  const pick = async (m: Match) => {
    await post(`/api/admin/items/${item.id}/identify`, { tmdbId: m.id })
    onDone()
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="card w-full max-w-xl max-h-[85vh] flex flex-col fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center p-4 border-b border-line">
          <h3 className="font-bold">Fix match</h3>
          <button onClick={onClose} className="ml-auto icon-btn !size-8"><X className="size-4" /></button>
        </div>
        <form className="flex gap-2 p-4" onSubmit={(e) => { e.preventDefault(); setQuery({ q, year }) }}>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title" />
          <input className="input !w-24" value={year} onChange={(e) => setYear(e.target.value)} placeholder="Year" inputMode="numeric" />
          <button className="btn-accent !h-11">Search</button>
        </form>
        <div className="overflow-y-auto px-4 pb-4 space-y-2">
          {res.isLoading && <Spinner />}
          {res.error && <p className="text-sm text-red-300">{(res.error as Error).message}</p>}
          {res.data?.map((m) => (
            <button key={m.id} onClick={() => pick(m)} className="w-full flex gap-3 p-2 rounded-xl hover:bg-white/10 text-left">
              <Img src={m.poster} alt={m.title} className="w-12 aspect-[2/3] rounded-md shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold">{m.title} <span className="text-muted font-normal">{m.year || ''}</span></div>
                <p className="text-xs text-muted line-clamp-2">{m.overview}</p>
              </div>
            </button>
          ))}
          {res.data && !res.data.length && <p className="text-sm text-muted">No matches.</p>}
        </div>
      </div>
    </div>
  )
}
