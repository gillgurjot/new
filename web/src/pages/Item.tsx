import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Download, MoreHorizontal, Play, Plus, RefreshCw, RotateCcw, Search, Star, Users } from 'lucide-react'
import { ApiError, api, del, downloadUrl, imageUrl, landscapeUrl, personImage, post, posterUrl } from '../api/client'
import type { Item, ItemDetail, Party, UserData } from '../api/types'
import Img from '../components/Img'
import Row from '../components/Row'
import Spinner from '../components/Spinner'
import { Menu, MenuItem, Meta, Sheet, toast } from '../components/ui'
import { bytes, episodeLabel, formatRuntime, formatTime, plural, progressPct, resolutionLabel } from '../lib/format'
import { useUser } from '../lib/user'

export default function ItemPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const { data: item, isLoading, error } = useQuery({ queryKey: ['item', Number(id)], queryFn: () => api<ItemDetail>(`/api/items/${id}`), refetchOnMount: 'always' })
  if (error) {
    return <div className="pt-32 text-center text-muted">This title isn’t available.</div>
  }
  if (isLoading || !item) {
    return (
      <div>
        <div className="skeleton h-[52svh] md:h-[70vh]" />
        <div className="px-4 md:px-10 -mt-24 space-y-3 relative">
          <div className="skeleton h-10 w-2/3 max-w-md rounded-xl" />
          <div className="skeleton h-4 w-1/2 max-w-sm rounded" />
        </div>
      </div>
    )
  }
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['item'] })
    qc.invalidateQueries({ queryKey: ['children'] })
    qc.invalidateQueries({ queryKey: ['home'] })
    qc.invalidateQueries({ queryKey: ['favorites'] })
  }
  return <Detail key={item.id} item={item} onChange={refresh} />
}

/** Starts a watch party for an item and opens the player with the invite sheet. */
export async function startParty(nav: ReturnType<typeof useNavigate>, itemId: number, position = 0) {
  try {
    const p = await post<Party>('/api/party', { itemId, position })
    nav(`/play/${itemId}?party=${p.id}&invite=1`)
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Couldn’t start a watch party', 'error')
  }
}

function Detail({ item, onChange }: { item: ItemDetail; onChange: () => void }) {
  const user = useUser()
  const nav = useNavigate()
  const isPlayable = item.type === 'movie' || item.type === 'episode'
  const backdropId = item.type === 'movie' || item.type === 'series' ? item.id : item.seriesId
  const backdrop = item.images.backdrop ? imageUrl(item, 'backdrop', 1600) : backdropId ? `/api/images/${backdropId}/backdrop?w=1600` : landscapeUrl(item, 1600)
  const logo = item.type === 'movie' || item.type === 'series' ? imageUrl(item, 'logo', 420) : undefined
  const brightLogo = useBrightLogo(logo)

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
    let lastIdx = -1
    regular.forEach((e, i) => e.userData?.played && (lastIdx = i))
    return regular.slice(lastIdx + 1).find((e) => !e.userData?.played) || regular[0] || eps[0]
  }, [episodes.data, item])

  const playTarget = isPlayable ? item : nextEp
  const resumePos = playTarget?.userData?.played ? 0 : playTarget?.userData?.position || 0
  const ud = item.userData
  const toggle = async (kind: 'played' | 'favorite', on: boolean) => {
    try {
      await (on ? post<UserData>(`/api/items/${item.id}/${kind}`) : del<UserData>(`/api/items/${item.id}/${kind}`))
      if (kind === 'favorite') toast(on ? 'Added to My list' : 'Removed from My list', 'info')
      onChange()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t save that', 'error')
    }
  }

  const directors = item.people?.filter((p) => p.role === 'director' || p.role === 'creator') || []
  const cast = item.people?.filter((p) => p.role === 'actor' || p.role === 'guest') || []
  const playLabel = resumePos > 30 ? `Resume ${formatTime(resumePos)}` : (item.type === 'series' || item.type === 'season') && playTarget ? `Play ${episodeLabel(playTarget)}` : 'Play'

  return (
    <div className="pb-16">
      {/* Artwork */}
      <div className="relative h-[52svh] md:absolute md:inset-x-0 md:top-0 md:h-[80vh] overflow-hidden">
        {backdrop && <img src={backdrop} alt="" className="absolute inset-0 size-full object-cover object-[center_25%] md:opacity-70" />}
        <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/40 to-transparent md:via-bg/70 md:to-bg/20" />
        <div className="absolute inset-0 hidden md:block bg-gradient-to-r from-bg via-bg/50 to-transparent" />
      </div>

      <div className="relative -mt-32 md:mt-0 md:pt-36 px-4 md:px-10 flex flex-col md:flex-row gap-8 items-start">
        {item.type !== 'episode' && (
          <div className="hidden md:block w-60 lg:w-64 shrink-0 aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl shadow-black/50 ring-1 ring-white/15">
            <Img src={posterUrl(item, 300)} alt={item.title} className="size-full" />
          </div>
        )}
        {item.type === 'episode' && (
          <div className="hidden md:block w-[400px] shrink-0 aspect-video rounded-2xl overflow-hidden shadow-2xl shadow-black/50 ring-1 ring-white/15">
            <Img src={landscapeUrl(item, 640)} alt={item.title} className="size-full" />
          </div>
        )}
        <div className="flex-1 min-w-0 w-full fade-in">
          {item.seriesTitle && (
            <Link to={`/item/${item.seriesId}`} className="inline-block text-accent hover:text-fg font-semibold text-sm mb-1 transition">{item.seriesTitle}</Link>
          )}
          {logo ? (
            <img src={logo} alt={item.title} className={`${brightLogo ? 'title-logo' : ''} max-h-24 md:max-h-32 max-w-[80%] object-contain object-left mb-4 dark:drop-shadow-[0_4px_24px_rgba(0,0,0,.6)]`} />
          ) : (
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-tight mb-3">{item.title}</h1>
          )}
          <Meta
            className="text-sm text-fg/75 font-medium mb-4"
            parts={[
              item.type === 'episode' ? <span className="text-fg">{episodeLabel(item)}</span> : null,
              item.year || null,
              item.rating ? <span className="inline-flex items-center gap-1"><Star className="size-3.5 fill-amber-400 text-amber-400" />{item.rating.toFixed(1)}</span> : null,
              item.contentRating ? <span className="chip">{item.contentRating}</span> : null,
              isPlayable ? formatRuntime(item.runtime, item.duration) : null,
              item.type === 'series' && item.childCount ? plural(item.childCount, 'season') : null,
              item.media ? <span className="chip">{resolutionLabel(item.media.width, item.media.height)}</span> : null,
              item.media?.hdr ? <span className="chip !border-amber-500/50 !text-amber-500">{item.media.hdr === 'dovi' ? 'Dolby Vision' : item.media.hdr.toUpperCase()}</span> : null,
            ]}
          />

          {/* Actions */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
            {playTarget && (
              <button onClick={() => nav(`/play/${playTarget.id}`)} className="btn-primary !h-12 !px-7 !text-base w-full sm:w-auto">
                <Play className="size-5 fill-current" /> {playLabel}
              </button>
            )}
            <div className="flex items-center gap-2.5">
              {playTarget && resumePos > 30 && (
                <ActionBtn label="Start over" onClick={() => nav(`/play/${playTarget.id}?t=0`)}><RotateCcw className="size-5" /></ActionBtn>
              )}
              {playTarget && (
                <ActionBtn label="Together" title="Watch together" onClick={() => startParty(nav, playTarget.id, resumePos > 30 ? resumePos : 0)}><Users className="size-5" /></ActionBtn>
              )}
              <ActionBtn label="My list" title={ud?.favorite ? 'Remove from My list' : 'Add to My list'} on={ud?.favorite} onClick={() => toggle('favorite', !ud?.favorite)}>
                {ud?.favorite ? <Check className="size-5" /> : <Plus className="size-5" />}
              </ActionBtn>
              <ActionBtn label="Watched" title={ud?.played ? 'Mark as unwatched' : 'Mark as watched'} on={ud?.played} onClick={() => toggle('played', !ud?.played)}>
                <Check className="size-5" />
              </ActionBtn>
              {isPlayable && user.canDownload && item.media && (
                <a href={downloadUrl(item.id)} download onClick={() => toast(`Downloading ${bytes(item.media!.size)}`, 'info')} className="group flex flex-col items-center gap-1.5 w-16" title={`Download original file (${bytes(item.media.size)})`}>
                  <span className="icon-btn !size-11"><Download className="size-5" /></span>
                  <span className="text-[11px] text-muted group-hover:text-fg transition">Download</span>
                </a>
              )}
              {user.isAdmin && (item.type === 'movie' || item.type === 'series') && <AdminMenu item={item} onChange={onChange} />}
            </div>
          </div>
          {playTarget && progressPct(playTarget) > 0 && !playTarget.userData?.played && (
            <div className="mb-5 max-w-sm flex items-center gap-3 text-xs text-muted">
              <div className="flex-1 h-1 rounded-full bg-fg/15 overflow-hidden">
                <div className="h-full rounded-full bg-fg" style={{ width: `${progressPct(playTarget)}%` }} />
              </div>
              {formatTime(Math.max(0, (playTarget.duration || 0) - resumePos))} left
            </div>
          )}

          {item.tagline && <p className="italic text-fg/60 mb-2">{item.tagline}</p>}
          <Overview text={item.overview} />
          {item.genres.length > 0 && <div className="text-sm text-muted mt-4">{item.genres.join(' · ')}</div>}
          {item.media && <AudioLine item={item} />}
          {directors.length > 0 && (
            <div className="text-sm text-muted mt-1.5">
              {directors[0].role === 'creator' ? 'Created by ' : 'Directed by '}
              <span className="text-fg/85">{directors.map((d) => d.name).join(', ')}</span>
            </div>
          )}
        </div>
      </div>

      <div className="relative mt-10 md:mt-14 space-y-10 md:space-y-12">
        {(item.type === 'series' || item.type === 'season') && <Seasons item={item} episodes={episodes.data} />}
        {cast.length > 0 && (
          <Row title={item.type === 'episode' ? 'Guest stars' : 'Cast'}>
            {cast.map((p, i) => (
              <div key={p.name + i} className="!w-[96px] md:!w-[120px]">
                <div className="aspect-square rounded-full overflow-hidden bg-surface-2 ring-1 ring-fg/[.06]">
                  <Img src={personImage(p.profile)} alt={p.name} className="size-full" fallback={<span className="text-2xl font-semibold text-fg/30">{p.name.slice(0, 1)}</span>} />
                </div>
                <div className="text-center mt-2">
                  <div className="text-[13px] font-medium truncate">{p.name}</div>
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

/** True when a title logo is mostly white, so it needs a shadow on the light theme. */
function useBrightLogo(src?: string) {
  const [bright, setBright] = useState(false)
  useEffect(() => {
    setBright(false)
    if (!src) return
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (!alive) return
      const c = document.createElement('canvas')
      c.width = 64
      c.height = 24
      const g = c.getContext('2d')
      if (!g) return
      g.drawImage(img, 0, 0, c.width, c.height)
      const d = g.getImageData(0, 0, c.width, c.height).data
      let sum = 0
      let n = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue
        sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
        n++
      }
      setBright(n > 0 && sum / n > 170)
    }
    img.src = src
    return () => {
      alive = false
    }
  }, [src])
  return bright
}

const langNames: Record<string, string> = { eng: 'English', hin: 'Hindi', pan: 'Punjabi', spa: 'Spanish', fre: 'French', fra: 'French', ger: 'German', deu: 'German', ita: 'Italian', jpn: 'Japanese', kor: 'Korean', tam: 'Tamil', tel: 'Telugu', urd: 'Urdu', chi: 'Chinese', zho: 'Chinese', rus: 'Russian', por: 'Portuguese', ara: 'Arabic' }

/** "Audio: Hindi 5.1 · English Stereo" — shows there's a choice before pressing play. */
function AudioLine({ item }: { item: ItemDetail }) {
  const audio = item.media!.streams.filter((s) => s.type === 'audio')
  if (audio.length < 2) return null
  const ch = (n?: number) => (n === 6 ? '5.1' : n === 8 ? '7.1' : n === 2 ? 'Stereo' : n === 1 ? 'Mono' : n ? `${n}ch` : '')
  return (
    <div className="text-sm text-muted mt-1.5">
      Audio: <span className="text-fg/85">{audio.map((a) => [langNames[a.language || ''] || (a.language || 'Unknown').toUpperCase(), ch(a.channels)].filter(Boolean).join(' ')).join(' · ')}</span>
      <span className="text-muted"> — change it in the player</span>
    </div>
  )
}

function ActionBtn({ label, title, onClick, on, children }: { label: string; title?: string; onClick: () => void; on?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="group flex flex-col items-center gap-1.5 w-16" title={title || label} aria-label={title || label} aria-pressed={on}>
      <span className={`icon-btn !size-11 ${on ? '!bg-fg !text-bg' : ''}`}>{children}</span>
      <span className="text-[11px] text-muted group-hover:text-fg transition truncate max-w-full">{label}</span>
    </button>
  )
}

function Overview({ text }: { text?: string }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  const long = text.length > 220
  return (
    <div className="max-w-3xl">
      <p className={`text-[15px] text-fg/80 leading-relaxed ${open || !long ? '' : 'line-clamp-3'}`}>{text}</p>
      {long && (
        <button onClick={() => setOpen((o) => !o)} className="mt-1 text-sm font-medium text-fg/60 hover:text-fg inline-flex items-center gap-1">
          {open ? 'Less' : 'More'} <ChevronDown className={`size-4 transition ${open ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  )
}

function Seasons({ item, episodes }: { item: ItemDetail; episodes?: Item[] }) {
  const [sp, setSp] = useSearchParams()
  const seriesId = item.type === 'series' ? item.id : item.seriesId!
  const seasons = useQuery({ queryKey: ['children', seriesId], queryFn: () => api<Item[]>(`/api/items/${seriesId}/children`) })
  const list = seasons.data || []
  // The season you picked sticks; until then, the first one with something left to watch.
  // (Deriving it each render means marking an episode watched doesn't jump to another season.)
  const [picked, setSel] = useState<number>()
  const fromUrl = Number(sp.get('season'))
  const has = (id?: number) => !!id && list.some((s) => s.id === id)
  const sel = item.type === 'season' ? item.id
    : has(picked) ? picked
    : has(fromUrl) ? fromUrl
    : list.find((s) => s.unplayedCount && s.seasonNumber !== 0)?.id || list[0]?.id
  const eps = (episodes || []).filter((e) => e.parentId === sel)
  if (!list.length) return null
  return (
    <section className="px-4 md:px-10">
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-none -mx-4 px-4 md:mx-0 md:px-0 mb-5">
        {list.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              setSel(s.id)
              if (item.type === 'series') setSp({ season: String(s.id) }, { replace: true })
            }}
            className={sel === s.id ? 'pill-on' : 'pill'}
          >
            {s.title}
            {s.unplayedCount ? <span className={`text-xs ${sel === s.id ? 'text-bg/50' : 'text-fg/40'}`}>{s.unplayedCount}</span> : null}
          </button>
        ))}
      </div>
      {!episodes && <Spinner />}
      <div className="grid gap-2 lg:grid-cols-2 lg:gap-x-6">
        {eps.map((e) => <EpisodeRow key={e.id} ep={e} />)}
      </div>
    </section>
  )
}

function EpisodeRow({ ep }: { ep: Item }) {
  const user = useUser()
  const pct = progressPct(ep)
  return (
    <div className="group flex gap-3.5 p-2 -mx-2 rounded-3xl hover:bg-fg/[.05] transition">
      <Link to={`/play/${ep.id}`} className="relative w-36 sm:w-48 shrink-0 aspect-video rounded-2xl overflow-hidden bg-surface-2 ring-1 ring-inset ring-white/10">
        <Img src={landscapeUrl(ep, 320)} alt={ep.title} className="size-full" />
        <div className="absolute inset-0 grid place-items-center bg-black/0 group-hover:bg-black/35 transition">
          <Play className="size-7 fill-white text-white opacity-0 group-hover:opacity-100 transition drop-shadow" />
        </div>
        {ep.userData?.played && <span className="absolute top-1.5 right-1.5 size-5 rounded-full glass-dark text-white grid place-items-center"><Check className="size-3" strokeWidth={3} /></span>}
        {pct > 0 && <div className="absolute bottom-1.5 inset-x-1.5 h-1 rounded-full bg-white/25 overflow-hidden"><div className="h-full bg-white" style={{ width: `${pct}%` }} /></div>}
      </Link>
      <div className="min-w-0 flex-1 py-0.5 flex flex-col">
        <Link to={`/item/${ep.id}`} className="min-w-0">
          <div className="text-[13px] text-muted font-medium">
            {ep.seasonNumber === 0 ? 'Special' : 'Episode'} {ep.episodeNumber}{ep.episodeEnd ? `–${ep.episodeEnd}` : ''} · {formatRuntime(ep.runtime, ep.duration)}
          </div>
          <div className="font-semibold text-[15px] leading-snug line-clamp-2">{ep.title}</div>
          <p className="text-[13px] text-fg/60 mt-1 line-clamp-2 hidden sm:block">{ep.overview}</p>
        </Link>
      </div>
      {user.canDownload && (
        <a href={downloadUrl(ep.id)} download onClick={() => toast('Download started', 'info')} className="self-center icon-btn-plain !size-9 text-fg/50 hover:text-fg" title="Download original file" aria-label={`Download ${ep.title}`}>
          <Download className="size-[18px]" />
        </a>
      )}
    </div>
  )
}

function MediaInfo({ item }: { item: ItemDetail }) {
  const m = item.media!
  const audio = m.streams.filter((s) => s.type === 'audio')
  const subs = [...m.streams.filter((s) => s.type === 'subtitle'), ...m.sidecars]
  return (
    <section className="px-4 md:px-10">
      <h2 className="text-[17px] md:text-xl font-semibold tracking-tight mb-3">File details</h2>
      <div className="grid sm:grid-cols-3 gap-3 text-sm">
        <div className="card p-4">
          <div className="eyebrow mb-2">Video</div>
          <div>{m.videoCodec.toUpperCase()} {m.videoProfile && <span className="text-muted">({m.videoProfile})</span>}</div>
          <div>{m.width}×{m.height} {m.hdr && `· ${m.hdr.toUpperCase()}`}</div>
          <div className="text-muted">{m.container.toUpperCase()} · {(m.bitrate / 1e6).toFixed(1)} Mbps · {bytes(m.size)}</div>
        </div>
        <div className="card p-4">
          <div className="eyebrow mb-2">Audio</div>
          {audio.map((a) => <div key={a.index} className="truncate">{(a.language || 'und').toUpperCase()} · {a.codec.toUpperCase()} {a.channels}ch {a.title && <span className="text-muted">· {a.title}</span>}</div>)}
          {!audio.length && <div className="text-muted">None</div>}
        </div>
        <div className="card p-4">
          <div className="eyebrow mb-2">Subtitles</div>
          {subs.map((s) => <div key={`${s.external ? 'x' : 'e'}${s.index}`} className="truncate">{(s.language || 'und').toUpperCase()} · {s.codec.toUpperCase()}{s.forced ? ' · Forced' : ''}{s.external ? ' · External' : ''}</div>)}
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
    try {
      await post(`/api/admin/items/${item.id}/refresh`)
      toast('Refreshing metadata…', 'info')
      setTimeout(() => {
        setBusy(false)
        onChange()
      }, 4000)
    } catch (e) {
      setBusy(false)
      toast(e instanceof ApiError ? e.message : 'Couldn’t refresh', 'error')
    }
  }
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="group flex flex-col items-center gap-1.5 w-16" title="More">
        <span className="icon-btn !size-11">{busy ? <Spinner className="size-5" /> : <MoreHorizontal className="size-5" />}</span>
        <span className="text-[11px] text-muted group-hover:text-fg transition">More</span>
      </button>
      <Menu open={open} onClose={() => setOpen(false)} className="!right-auto -left-32 sm:left-0">
        <MenuItem icon={<RefreshCw className="size-4" />} onClick={refresh}>Refresh metadata</MenuItem>
        <MenuItem icon={<Search className="size-4" />} onClick={() => { setIdentify(true); setOpen(false) }}>Fix match…</MenuItem>
      </Menu>
      <IdentifyDialog open={identify} item={item} onClose={() => setIdentify(false)} onDone={() => { setIdentify(false); toast('Updating match…', 'info'); setTimeout(onChange, 4000) }} />
    </div>
  )
}

interface Match { id: number; title: string; year: number; overview: string; poster?: string }

function IdentifyDialog({ open, item, onClose, onDone }: { open: boolean; item: Item; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState(item.title)
  const [year, setYear] = useState(item.year ? String(item.year) : '')
  const [query, setQuery] = useState({ q: item.title, year })
  const res = useQuery({
    queryKey: ['identify', item.id, query],
    queryFn: () => api<Match[]>(`/api/admin/identify?itemId=${item.id}&q=${encodeURIComponent(query.q)}&year=${query.year}`),
    retry: false,
    enabled: open,
  })
  const pick = async (m: Match) => {
    try {
      await post(`/api/admin/items/${item.id}/identify`, { tmdbId: m.id })
      onDone()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Couldn’t update the match', 'error')
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Fix match">
      <form className="flex gap-2 mb-4" onSubmit={(e) => { e.preventDefault(); setQuery({ q, year }) }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title" />
        <input className="input !w-24" value={year} onChange={(e) => setYear(e.target.value)} placeholder="Year" inputMode="numeric" />
        <button className="btn-accent !h-11 !px-4">Search</button>
      </form>
      <div className="space-y-1">
        {res.isLoading && <Spinner />}
        {res.error && <p className="text-sm text-red-500">{(res.error as Error).message}</p>}
        {res.data?.map((m) => (
          <button key={m.id} onClick={() => pick(m)} className="w-full flex gap-3 p-2 rounded-2xl hover:bg-fg/[.06] text-left">
            <Img src={m.poster} alt={m.title} className="w-12 aspect-[2/3] rounded-md shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold">{m.title} <span className="text-muted font-normal">{m.year || ''}</span></div>
              <p className="text-xs text-muted line-clamp-2">{m.overview}</p>
            </div>
          </button>
        ))}
        {res.data && !res.data.length && <p className="text-sm text-muted">No matches.</p>}
      </div>
    </Sheet>
  )
}
